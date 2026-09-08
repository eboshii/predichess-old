// network.js — Real-time 2-player multiplayer room manager for Predichess
// Zero-login, zero-backend, instant room creation with a 5-character code.
// Uses redundant transports: MQTT over WebSocket (works through all NATs/firewalls)
// + WebRTC DataChannel via PeerJS for low-latency peer-to-peer play.

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateGameCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

export function isValidGameCode(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.trim().toUpperCase();
  if (clean.length !== 5) return false;
  for (const c of clean) {
    if (!CODE_CHARS.includes(c)) return false;
  }
  return true;
}

export class RoomManager {
  constructor() {
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.myId = 'player_' + Math.random().toString(36).substring(2, 9);
    this.myName = 'Player';
    this.opponentName = 'Opponent';
    this.connected = false;
    this.mqttClient = null;
    this.peer = null;
    this.dataConnection = null;
    this.seenMsgIds = new Set();
    this.callbacks = {};
    this.heartbeatTimer = null;
    this.lastOpponentHeartbeat = 0;
    this.reconnectAttempts = 0;
  }

  init(myName) {
    this.myName = myName || 'Player';
  }

  // --- HOST A GAME WITH 5-LETTER CODE ---
  host(code, options = {}, callbacks = {}) {
    this.disconnect();
    this.role = 'host';
    this.code = code.toUpperCase();
    this.callbacks = callbacks;
    this.options = options;
    this.seenMsgIds.clear();

    console.log(`[Network] Hosting game with code: ${this.code}`);
    this._initMqtt();
    this._initPeerHost();
    this._startHeartbeat();
  }

  // --- JOIN AN EXISTING GAME WITH 5-LETTER CODE ---
  join(code, playerInfo = {}, callbacks = {}) {
    this.disconnect();
    this.role = 'guest';
    this.code = code.toUpperCase();
    this.myName = playerInfo.name || this.myName;
    this.callbacks = callbacks;
    this.seenMsgIds.clear();

    console.log(`[Network] Joining game with code: ${this.code}`);
    this._initMqtt();
    this._initPeerGuest();
    this._startHeartbeat();
  }

  // --- SEND MESSAGE TO OPPONENT ---
  send(type, payload = {}) {
    const msg = {
      id: Math.random().toString(36).substring(2, 10) + '_' + Date.now(),
      senderId: this.myId,
      senderName: this.myName,
      role: this.role,
      type,
      payload,
      timestamp: Date.now()
    };

    let sent = false;

    // 1. Try sending over WebRTC DataConnection
    if (this.dataConnection && this.dataConnection.open) {
      try {
        this.dataConnection.send(msg);
        sent = true;
      } catch (e) {
        console.warn('[Network] WebRTC send failed, falling back to MQTT', e);
      }
    }

    // 2. Also send over MQTT for reliability / redundancy
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        const topic = `predichess/v2/room/${this.code.toLowerCase()}`;
        this.mqttClient.publish(topic, JSON.stringify(msg), { qos: 1 });
        sent = true;
      } catch (e) {
        console.warn('[Network] MQTT publish error', e);
      }
    }

    return sent;
  }

  // --- RECEIVE & DISPATCH MESSAGES ---
  _handleIncomingMessage(msg) {
    if (!msg || !msg.id) return;
    if (msg.senderId === this.myId) return; // Ignore own messages
    if (this.seenMsgIds.has(msg.id)) return; // Deduplicate

    this.seenMsgIds.add(msg.id);
    if (this.seenMsgIds.size > 200) {
      const arr = Array.from(this.seenMsgIds).slice(-100);
      this.seenMsgIds = new Set(arr);
    }

    this.lastOpponentHeartbeat = Date.now();

    // Built-in handshake handling
    if (msg.type === 'PING') {
      this.send('PONG', { time: Date.now() });
      return;
    }
    if (msg.type === 'PONG') {
      return;
    }

    if (this.role === 'host' && msg.type === 'GUEST_HELLO') {
      console.log('[Network] Guest hello received from:', msg.senderName);
      this.opponentName = msg.senderName;
      this.connected = true;
      // Send welcome / game configuration back to guest
      this.send('HOST_WELCOME', {
        hostName: this.myName,
        guestName: msg.senderName,
        timerType: this.options.timerType || 'rapid_20m',
        timeLimit: this.options.timeLimit || 1200000,
        hostColor: this.options.hostColor || 'WHITE'
      });
      if (this.callbacks.onPlayerJoined) {
        this.callbacks.onPlayerJoined({
          opponentName: msg.senderName,
          role: 'host',
          options: this.options
        });
      }
      return;
    }

    if (this.role === 'guest' && msg.type === 'HOST_WELCOME') {
      console.log('[Network] Host welcome received from:', msg.senderName);
      this.opponentName = msg.senderName;
      this.connected = true;
      if (this.callbacks.onConnected) {
        this.callbacks.onConnected({
          opponentName: msg.senderName,
          role: 'guest',
          config: msg.payload
        });
      }
      return;
    }

    // Pass custom application messages to game controller
    if (this.callbacks.onMessage) {
      this.callbacks.onMessage(msg.type, msg.payload, msg);
    }
  }

  // --- MQTT TRANSPORT (WebSocket) ---
  _initMqtt() {
    if (typeof window.mqtt === 'undefined') {
      console.warn('[Network] MQTT library not found on window, relying solely on PeerJS');
      return;
    }

    const brokerUrls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    const url = brokerUrls[this.reconnectAttempts % brokerUrls.length];
    const topic = `predichess/v2/room/${this.code.toLowerCase()}`;

    try {
      this.mqttClient = window.mqtt.connect(url, {
        clientId: `pc_${this.myId}_${Math.floor(Math.random() * 1000)}`,
        clean: true,
        connectTimeout: 7000,
        reconnectPeriod: 2500,
        keepalive: 30
      });

      this.mqttClient.on('connect', () => {
        console.log(`[Network] MQTT connected to ${url}, subscribing to ${topic}`);
        this.mqttClient.subscribe(topic, { qos: 1 });

        if (this.role === 'guest') {
          // Say hello to host
          this.send('GUEST_HELLO', { name: this.myName });
        } else if (this.role === 'host') {
          this.send('HOST_ANNOUNCE', { name: this.myName });
        }
      });

      this.mqttClient.on('message', (t, payload) => {
        try {
          const str = payload.toString();
          const data = JSON.parse(str);
          this._handleIncomingMessage(data);
        } catch (e) {
          console.error('[Network] MQTT parse error:', e);
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn('[Network] MQTT error:', err);
      });
    } catch (e) {
      console.error('[Network] Failed to initialize MQTT:', e);
    }
  }

  // --- PEERJS TRANSPORT (WebRTC) ---
  _initPeerHost() {
    if (typeof window.Peer === 'undefined') return;

    try {
      const peerId = `predichess-v2-${this.code.toLowerCase()}`;
      this.peer = new window.Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        console.log('[Network] PeerJS host registered ID:', id);
      });

      this.peer.on('connection', (conn) => {
        console.log('[Network] WebRTC connection received from guest!');
        this.dataConnection = conn;
        this._setupDataConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('[Network] PeerJS host error (normal if fallback to MQTT):', err.type);
      });
    } catch (e) {
      console.warn('[Network] PeerJS host init failed:', e);
    }
  }

  _initPeerGuest() {
    if (typeof window.Peer === 'undefined') return;

    try {
      this.peer = new window.Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      this.peer.on('open', () => {
        const hostPeerId = `predichess-v2-${this.code.toLowerCase()}`;
        console.log('[Network] Guest attempting WebRTC connect to:', hostPeerId);
        const conn = this.peer.connect(hostPeerId, { reliable: true });
        this.dataConnection = conn;
        this._setupDataConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('[Network] PeerJS guest error (fallback to MQTT active):', err.type);
      });
    } catch (e) {
      console.warn('[Network] PeerJS guest init failed:', e);
    }
  }

  _setupDataConnection(conn) {
    conn.on('open', () => {
      console.log('[Network] WebRTC DataConnection open and active!');
      if (this.role === 'guest') {
        this.send('GUEST_HELLO', { name: this.myName });
      }
    });

    conn.on('data', (data) => {
      this._handleIncomingMessage(data);
    });

    conn.on('close', () => {
      console.log('[Network] WebRTC DataConnection closed');
    });

    conn.on('error', (err) => {
      console.warn('[Network] DataConnection error:', err);
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.lastOpponentHeartbeat = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.send('PING', { time: Date.now() });

        // Check if opponent timed out (e.g. 20 seconds without a heartbeat/message)
        if (this.lastOpponentHeartbeat && Date.now() - this.lastOpponentHeartbeat > 25000) {
          if (this.callbacks.onOpponentTimeout) {
            this.callbacks.onOpponentTimeout();
          }
        }
      } else if (this.role === 'guest') {
        // Retry hello while waiting for host
        this.send('GUEST_HELLO', { name: this.myName });
      }
    }, 4000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect() {
    this._stopHeartbeat();
    this.connected = false;

    if (this.dataConnection) {
      try { this.dataConnection.close(); } catch (_) {}
      this.dataConnection = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch (_) {}
      this.mqttClient = null;
    }
  }
}
