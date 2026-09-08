// app.js — Predichess Web Controller
// Stylised after eboshii.dev (Dark Retro Cosmic Theme)
// Realtime 2-player multiplayer with 5-character invite codes, offline bot, and pass & play

import {
  ChessBoard,
  PieceColor,
  PieceType,
  GameResult,
  ChessMove,
  BotEngine
} from './chess.js';

import {
  generateGameCode,
  isValidGameCode,
  RoomManager
} from './network.js';

// --- SOUND MANAGER ---
const SoundManager = {
  sounds: {
    move: new URL('sounds/move.mp3', import.meta.url).href,
    capture: new URL('sounds/capture.mp3', import.meta.url).href,
    explosion: new URL('sounds/explosion.mp3', import.meta.url).href,
    genericnotify: new URL('sounds/genericnotify.mp3', import.meta.url).href,
    lowtime: new URL('sounds/lowtime.mp3', import.meta.url).href
  },

  playSound(name, pitch = 1.0) {
    try {
      const src = this.sounds[name];
      if (!src) return;
      const audio = new Audio(src);
      audio.preservesPitch = false;
      audio.playbackRate = pitch;
      audio.play().catch(() => {});
    } catch (_) {}
  }
};

// --- GLOBAL STATE ---
let currentUsername = localStorage.getItem('predichess_player_name') || 'Player ' + Math.floor(100 + Math.random() * 900);
let activeGameMode = null; // 'online' | 'bot' | 'pass_play'
let activeGameId = null;
let activeGame = null;

let activeBoard = new ChessBoard();
let isFlipped = false;
let myColor = PieceColor.WHITE;

let reviewIndex = -1;
let selSquare = null;
let legalTargets = [];
let promotionPendingMove = null;

// Network room manager for 2-player online matches
const roomManager = new RoomManager();
let hostTimerType = 'rapid_20m';
let hostCode = '';

// Sound and event trackers
let renderedEventsCount = -1;
let lastPlayedLowTimeSecond = -1;
let previousTurn = "";
let previousPhase = "";
let lastAnimatedTrapIndex = -1;

// Clock ticker
let clockInterval = null;

// Offline bot state
let selectedBotElo = 1200;
let botWorker = null;
let botRunning = false;
let botRequestId = 0;

// Pass & Play state
let passPlayBlindfoldPending = false;

// --- INITIALIZATION & LIFECYCLE ---
export function initApp() {
  activeGameMode = null;
  activeGameId = null;
  activeGame = null;
  activeBoard = new ChessBoard();
  reviewIndex = -1;
  selSquare = null;
  legalTargets = [];
  promotionPendingMove = null;

  initPlayerProfile();
  initLobbyHandlers();
  initGameHandlers();
  initBoardInteraction();
  checkUrlInviteCode();
  showScreen('lobby');
  try { localStorage.removeItem('predichess_saved_bot_game'); } catch (_) {}
}

export function cleanupApp() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  if (botWorker) {
    botWorker.terminate();
    botWorker = null;
    botRunning = false;
  }
  if (roomManager) {
    roomManager.disconnect();
  }
  document.querySelectorAll('.dialog-overlay').forEach(d => d.classList.remove('active'));
}

window.initPredichessApp = initApp;
window.cleanupPredichessApp = cleanupApp;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initPageTransitions();
    initApp();
  });
} else {
  initPageTransitions();
  initApp();
}

// --- PAGE & SCREEN TRANSITIONS (Cosmic 3px Bayer Dither) ---
function initPageTransitions() {
  const appRoot = document.getElementById('app-root');
  if (appRoot) {
    appRoot.classList.add('dither-enter');
    setTimeout(() => appRoot.classList.remove('dither-enter'), 135);
  }
}

// --- SCREEN SWITCHER ---
function showScreen(screenId) {
  const currentScreen = document.querySelector('.screen.active');
  const target = document.getElementById(`screen-${screenId}`);
  if (!target || currentScreen === target) return;

  if (currentScreen) {
    currentScreen.classList.add('dither-exit');
    setTimeout(() => {
      currentScreen.classList.remove('active', 'dither-exit');
      target.classList.add('active', 'dither-enter');
      setTimeout(() => target.classList.remove('dither-enter'), 135);
    }, 85);
  } else {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    target.classList.add('active', 'dither-enter');
    setTimeout(() => target.classList.remove('dither-enter'), 135);
  }
}

// --- PLAYER PROFILE ---
function initPlayerProfile() {
  updatePlayerNameDisplay();

  const profileBtn = document.getElementById('btn-player-profile');
  const modalEdit = document.getElementById('modal-edit-name');
  const inputName = document.getElementById('input-player-name');
  const btnSave = document.getElementById('btn-save-name');
  const btnCancel = document.getElementById('btn-cancel-name');

  profileBtn.addEventListener('click', () => {
    inputName.value = currentUsername;
    modalEdit.classList.add('active');
    setTimeout(() => inputName.focus(), 50);
  });

  btnSave.addEventListener('click', () => {
    const val = inputName.value.trim();
    if (val) {
      currentUsername = val.substring(0, 18);
      localStorage.setItem('predichess_player_name', currentUsername);
      updatePlayerNameDisplay();
      showToast('Display name updated!', 'success');
    }
    modalEdit.classList.remove('active');
  });

  btnCancel.addEventListener('click', () => {
    modalEdit.classList.remove('active');
  });
}

function updatePlayerNameDisplay() {
  const el = document.getElementById('header-player-name');
  if (el) el.textContent = currentUsername;
}

// --- CHECK URL INVITE CODE ---
function checkUrlInviteCode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || params.get('game');
    if (code && isValidGameCode(code)) {
      const input = document.getElementById('input-join-code');
      if (input) {
        input.value = code.toUpperCase();
        showToast(`Code ${code.toUpperCase()} detected`, 'info');
      }
      // Expand Online 2P section
      const onlineSec = document.getElementById('section-online');
      if (onlineSec) {
        onlineSec.classList.add('open');
        const b = onlineSec.querySelector('.menu-btn');
        if (b) b.setAttribute('aria-expanded', 'true');
      }
    }
  } catch (_) {}
}

// --- LOBBY HANDLERS ---
function initLobbyHandlers() {
  // Accordion Menu Toggle with dynamic shader glow color switching
  const sections = document.querySelectorAll('.menu-section');
  sections.forEach(sec => {
    const btn = sec.querySelector('.menu-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isOpen = sec.classList.contains('open');
      sections.forEach(s => {
        s.classList.remove('open');
        s.setAttribute('data-nx-glow', 'white');
        s._nxHot = false;
        const b = s.querySelector('.menu-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        sec.classList.add('open');
        sec.setAttribute('data-nx-glow', 'amber');
        sec._nxHot = true;
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // 1. Create Room (Host)
  const btnCreate = document.getElementById('btn-create-room');
  const modalHost = document.getElementById('modal-host-room');
  const btnCancelHost = document.getElementById('btn-cancel-host-room');
  const btnCopyCode = document.getElementById('btn-copy-room-code');
  const btnCopyLink = document.getElementById('btn-copy-room-link');
  const hostCodeDisplay = document.getElementById('host-room-code-display');

  btnCreate.addEventListener('click', () => {
    hostCode = generateGameCode();
    hostCodeDisplay.textContent = hostCode;
    modalHost.classList.add('active');

    // Start hosting network session
    startHostingOnlineGame(hostCode);
  });

  btnCancelHost.addEventListener('click', () => {
    roomManager.disconnect();
    modalHost.classList.remove('active');
  });

  btnCopyCode.addEventListener('click', () => {
    navigator.clipboard.writeText(hostCode).then(() => {
      showToast(`Code ${hostCode} copied to clipboard!`, 'success');
    }).catch(() => {
      showToast(`Game code: ${hostCode}`, 'info');
    });
  });

  btnCopyLink.addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?code=${hostCode}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Invite link copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Copy link failed, copy the 5-letter code instead.', 'error');
    });
  });

  // Time control chips in host modal
  document.querySelectorAll('.timer-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.timer-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      hostTimerType = chip.dataset.timer;
    });
  });

  // 2. Join Room (Guest)
  const formJoin = document.getElementById('form-join-code');
  const inputJoin = document.getElementById('input-join-code');
  const errJoin = document.getElementById('join-error-msg');

  formJoin.addEventListener('submit', () => {
    const code = inputJoin.value.trim().toUpperCase();
    if (!isValidGameCode(code)) {
      errJoin.textContent = 'Please enter a valid 5-character code (letters and numbers).';
      errJoin.style.display = 'block';
      return;
    }
    errJoin.style.display = 'none';
    joinOnlineGame(code);
  });

  inputJoin.addEventListener('input', () => {
    inputJoin.value = inputJoin.value.toUpperCase();
    errJoin.style.display = 'none';
  });

  // 3. Bot Controls
  document.querySelectorAll('.elo-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.elo-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedBotElo = parseInt(chip.dataset.elo, 10);
    });
  });

  document.getElementById('btn-start-bot').addEventListener('click', () => {
    startBotGame(selectedBotElo);
  });

  // 4. Pass & Play
  document.getElementById('btn-start-pass-play').addEventListener('click', () => {
    startPassAndPlayGame();
  });
}

// --- 2-PLAYER ONLINE MULTIPLAYER ENGINE ---
function getStartingTime(timerType) {
  switch (timerType) {
    case 'blitz_10m': return 600000;
    case 'rapid_20m': return 1200000;
    case 'rapid_30m': return 1800000;
    case 'untimed': return 0;
    default: return 1200000;
  }
}

function startHostingOnlineGame(code) {
  roomManager.init(currentUsername);
  const timeLimit = getStartingTime(hostTimerType);

  roomManager.host(code, {
    timerType: hostTimerType,
    timeLimit: timeLimit,
    hostColor: 'WHITE'
  }, {
    onPlayerJoined: (guestInfo) => {
      document.getElementById('modal-host-room').classList.remove('active');
      showToast(`${guestInfo.opponentName} joined the game!`, 'success');
      SoundManager.playSound('genericnotify', 1.2);

      // Create host active game state
      activeGameMode = 'online';
      activeGameId = code;
      myColor = PieceColor.WHITE;
      isFlipped = false;

      activeGame = {
        id: code,
        whiteUsername: currentUsername,
        blackUsername: guestInfo.opponentName,
        currentTurn: 'white',
        phase: 'move',
        events: [],
        predictions: [],
        pendingPrediction: '',
        status: 'active',
        result: '',
        timerType: hostTimerType,
        whiteTimeLeft: timeLimit,
        blackTimeLeft: timeLimit,
        lastActionTime: Date.now()
      };

      enterActiveGameRoom();
    },

    onMessage: (type, payload) => {
      handleOnlineMessage(type, payload);
    },

    onOpponentTimeout: () => {
      showToast('Opponent connection lost...', 'error');
      updateConnectionStatus(false);
    }
  });
}

function joinOnlineGame(code) {
  showToast(`Connecting to room ${code}...`, 'info');
  roomManager.init(currentUsername);

  roomManager.join(code, { name: currentUsername }, {
    onConnected: (info) => {
      showToast(`Connected to ${info.opponentName}'s game!`, 'success');
      SoundManager.playSound('genericnotify', 1.2);

      activeGameMode = 'online';
      activeGameId = code;
      myColor = PieceColor.BLACK;
      isFlipped = true;

      const timeLimit = info.config ? (info.config.timeLimit || 1200000) : 1200000;
      const timerType = info.config ? (info.config.timerType || 'rapid_20m') : 'rapid_20m';

      activeGame = {
        id: code,
        whiteUsername: info.opponentName,
        blackUsername: currentUsername,
        currentTurn: 'white',
        phase: 'move',
        events: [],
        predictions: [],
        pendingPrediction: '',
        status: 'active',
        result: '',
        timerType: timerType,
        whiteTimeLeft: timeLimit,
        blackTimeLeft: timeLimit,
        lastActionTime: Date.now()
      };

      enterActiveGameRoom();
    },

    onMessage: (type, payload) => {
      handleOnlineMessage(type, payload);
    },

    onOpponentTimeout: () => {
      showToast('Opponent connection lost...', 'error');
      updateConnectionStatus(false);
    }
  });
}

function handleOnlineMessage(type, payload) {
  if (!activeGame) return;
  updateConnectionStatus(true);

  switch (type) {
    case 'GAME_MOVE': {
      // Opponent completed their move; update board
      const uci = payload.uci;
      if (!uci) return;

      // Deduct opponent's elapsed time
      if (payload.whiteTimeLeft !== undefined) activeGame.whiteTimeLeft = payload.whiteTimeLeft;
      if (payload.blackTimeLeft !== undefined) activeGame.blackTimeLeft = payload.blackTimeLeft;
      activeGame.lastActionTime = Date.now();

      // Check if opponent moved into my secret prediction!
      if (activeGame.pendingPrediction && uci === activeGame.pendingPrediction) {
        const fromSquare = uci.substring(0, 2);
        const fromCol = uci.charCodeAt(0) - 'a'.charCodeAt(0);
        const fromRow = 8 - parseInt(uci[1], 10);
        const piece = activeBoard.squares[fromRow][fromCol];
        const trapEvent = `trap:${fromSquare}`;
        const isKing = piece && piece.type === PieceType.KING;

        if (isKing) {
          activeGame.events.push(trapEvent);
          activeGame.predictions.push(activeGame.pendingPrediction);
          activeGame.status = 'finished';
          activeGame.result = myColor === PieceColor.WHITE ? 'white_wins' : 'black_wins';
          activeGame.pendingPrediction = '';

          roomManager.send('GAME_TRAP', {
            trapEvent,
            prediction: uci,
            isKing: true,
            winner: myColor === PieceColor.WHITE ? 'white' : 'black'
          });

          renderGameRoom();
          showDialog('VICTORY!', 'Opponent moved their King into your secret prediction! Their King was destroyed.', [
            { text: 'Lobby', type: 'confirm', action: () => exitGameToLobby() }
          ]);
        } else {
          activeGame.events.push(trapEvent);
          activeGame.predictions.push(activeGame.pendingPrediction);
          // Opponent's piece is destroyed; they must move again!
          activeGame.phase = 'move';
          activeGame.pendingPrediction = '';

          roomManager.send('GAME_TRAP', {
            trapEvent,
            prediction: uci,
            isKing: false
          });

          renderGameRoom();
          showToast('TRAP SPRUNG! Opponent walked into your prediction!', 'success');
        }
      } else {
        // Normal move by opponent
        activeGame.events.push(uci);
        activeGame.predictions.push(activeGame.pendingPrediction || '');
        activeGame.pendingPrediction = '';
        activeGame.phase = 'predict'; // Opponent is now predicting our move

        roomManager.send('GAME_MOVE_ACK', { eventsCount: activeGame.events.length });
        renderGameRoom();
      }
      break;
    }

    case 'GAME_TRAP': {
      // Opponent notified us that our move walked into their prediction!
      const trapEvent = payload.trapEvent;
      activeGame.events.push(trapEvent);
      activeGame.predictions.push(payload.prediction || '');
      activeGame.pendingPrediction = '';

      if (payload.isKing) {
        activeGame.status = 'finished';
        activeGame.result = payload.winner === 'white' ? 'white_wins' : 'black_wins';
        renderGameRoom();
        showDialog('DEFEAT', 'You moved your King into opponent\'s secret prediction! King vaporized.', [
          { text: 'Lobby', type: 'cancel', action: () => exitGameToLobby() }
        ]);
      } else {
        // Our piece was destroyed, we must move again
        activeGame.phase = 'move';
        renderGameRoom();
        showToast('TRAP SPRUNG! Your piece was vaporized! Make another move.', 'error');
        SoundManager.playSound('explosion', 1.0);
      }
      break;
    }

    case 'GAME_PREDICT_LOCKED': {
      // Opponent locked in their prediction; now it's our turn to move!
      if (payload.whiteTimeLeft !== undefined) activeGame.whiteTimeLeft = payload.whiteTimeLeft;
      if (payload.blackTimeLeft !== undefined) activeGame.blackTimeLeft = payload.blackTimeLeft;
      activeGame.lastActionTime = Date.now();

      activeGame.phase = 'move';
      activeGame.currentTurn = myColor === PieceColor.WHITE ? 'white' : 'black';
      renderGameRoom();
      SoundManager.playSound('genericnotify', 1.2);
      break;
    }

    case 'GAME_RESIGN': {
      activeGame.status = 'finished';
      activeGame.result = myColor === PieceColor.WHITE ? 'white_wins' : 'black_wins';
      renderGameRoom();
      showDialog('VICTORY', 'Opponent resigned the match.', [
        { text: 'Return to Lobby', type: 'confirm', action: () => exitGameToLobby() }
      ]);
      break;
    }
  }
}

function updateConnectionStatus(isOnline) {
  const dot = document.getElementById('connection-status-dot');
  if (!dot) return;
  dot.className = `conn-dot ${isOnline ? 'online' : 'offline'}`;
  dot.title = isOnline ? 'Connected to opponent' : 'Connection waiting...';
}

// --- ENTER ACTIVE GAME ROOM ---
function enterActiveGameRoom() {
  reviewIndex = -1;
  selSquare = null;
  legalTargets = [];
  promotionPendingMove = null;

  renderedEventsCount = -1;
  lastPlayedLowTimeSecond = -1;
  previousTurn = "";
  previousPhase = "";
  lastAnimatedTrapIndex = -1;

  showScreen('game');

  // Room code badge in game bar
  const roomBadge = document.getElementById('game-room-code-badge');
  const roomVal = document.getElementById('game-room-code-val');
  if (activeGameMode === 'online') {
    roomBadge.style.display = 'inline-flex';
    roomVal.textContent = activeGameId;
    roomBadge.onclick = () => {
      const url = `${window.location.origin}${window.location.pathname}?code=${activeGameId}`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Invite link copied to clipboard!', 'success');
      });
    };
  } else {
    roomBadge.style.display = 'none';
  }

  // Update Player names
  document.getElementById('game-my-name').textContent =
    myColor === PieceColor.WHITE ? activeGame.whiteUsername : activeGame.blackUsername;
  document.getElementById('game-opponent-name').textContent =
    myColor === PieceColor.WHITE ? activeGame.blackUsername : activeGame.whiteUsername;

  renderGameRoom();
  startGameClocks();
}

function exitGameToLobby() {
  stopGameClocks();
  if (activeGameMode === 'online') {
    roomManager.disconnect();
  }
  activeGame = null;
  activeGameId = null;
  activeGameMode = null;
  showScreen('lobby');
}

// --- GAME CLOCKS ---
function startGameClocks() {
  stopGameClocks();
  const timerOpp = document.getElementById('game-opponent-timer');
  const timerMy = document.getElementById('game-my-timer');

  if (!activeGame || activeGame.timerType === 'untimed') {
    timerOpp.style.display = 'none';
    timerMy.style.display = 'none';
    return;
  }

  timerOpp.style.display = 'inline-block';
  timerMy.style.display = 'inline-block';

  clockInterval = setInterval(() => {
    if (!activeGame || activeGame.status !== 'active') return;

    const now = Date.now();
    const elapsed = now - (activeGame.lastActionTime || now);
    activeGame.lastActionTime = now;

    const isWhiteTurn = activeGame.currentTurn === 'white';
    if (isWhiteTurn) {
      activeGame.whiteTimeLeft = Math.max(0, (activeGame.whiteTimeLeft || 1200000) - elapsed);
      if (activeGame.whiteTimeLeft === 0) {
        handleTimeout('white');
      }
    } else {
      activeGame.blackTimeLeft = Math.max(0, (activeGame.blackTimeLeft || 1200000) - elapsed);
      if (activeGame.blackTimeLeft === 0) {
        handleTimeout('black');
      }
    }

    updateTimerDisplay();
  }, 1000);

  updateTimerDisplay();
}

function stopGameClocks() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

function formatTime(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateTimerDisplay() {
  if (!activeGame) return;
  const myTimerEl = document.getElementById('game-my-timer');
  const oppTimerEl = document.getElementById('game-opponent-timer');

  const myTime = myColor === PieceColor.WHITE ? activeGame.whiteTimeLeft : activeGame.blackTimeLeft;
  const oppTime = myColor === PieceColor.WHITE ? activeGame.blackTimeLeft : activeGame.whiteTimeLeft;

  if (myTimerEl) myTimerEl.textContent = formatTime(myTime || 0);
  if (oppTimerEl) oppTimerEl.textContent = formatTime(oppTime || 0);

  // Sound alert for low time
  if (myTime > 0 && myTime <= 30000) {
    const sec = Math.ceil(myTime / 1000);
    if (sec <= 10 && sec !== lastPlayedLowTimeSecond) {
      lastPlayedLowTimeSecond = sec;
      SoundManager.playSound('lowtime', 1.0);
    }
  }
}

function handleTimeout(colorLost) {
  if (!activeGame || activeGame.status !== 'active') return;
  activeGame.status = 'finished';
  activeGame.result = colorLost === 'white' ? 'black_wins' : 'white_wins';
  stopGameClocks();
  renderGameRoom();

  const isMe = (colorLost === 'white' && myColor === PieceColor.WHITE) ||
               (colorLost === 'black' && myColor === PieceColor.BLACK);
  showDialog('TIME OUT', isMe ? 'Your clock reached zero. You lost on time.' : 'Opponent ran out of time! You win.', [
    { text: 'Return to Lobby', type: 'confirm', action: () => exitGameToLobby() }
  ]);
}

// --- RENDER GAME ROOM ---
function renderGameRoom() {
  if (!activeGame) return;

  const events = activeGame.events || [];
  const eventsToApply = reviewIndex === -1 ? events : events.slice(0, reviewIndex);

  // Reconstruct board position
  activeBoard.applyMoves(eventsToApply);

  // Check sounds for newly added events
  if (renderedEventsCount !== -1 && events.length > renderedEventsCount) {
    const latest = events[events.length - 1];
    if (latest.startsWith('trap:')) {
      SoundManager.playSound('explosion', 1.0);
    } else {
      SoundManager.playSound('move', 1.0);
    }
  }
  renderedEventsCount = events.length;

  renderBoardGrid();
  renderMoveLog();
  updateGameHUD();
}

function renderBoardGrid() {
  const grid = document.getElementById('chess-board-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const events = activeGame.events || [];
  let lastMove = null;
  const currentViewEvents = reviewIndex === -1 ? events : events.slice(0, reviewIndex);
  if (currentViewEvents.length > 0) {
    lastMove = currentViewEvents[currentViewEvents.length - 1];
  }

  // Determine which king is in check
  let whiteKingInCheck = false;
  let blackKingInCheck = false;
  if (activeBoard.isKingInCheck(PieceColor.WHITE)) whiteKingInCheck = true;
  if (activeBoard.isKingInCheck(PieceColor.BLACK)) blackKingInCheck = true;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const displayRow = isFlipped ? 7 - r : r;
      const displayCol = isFlipped ? 7 - c : c;

      const sq = document.createElement('div');
      sq.className = `square ${(displayRow + displayCol) % 2 === 0 ? 'light' : 'dark'}`;
      sq.dataset.row = displayRow;
      sq.dataset.col = displayCol;

      const squareName = `${'abcdefgh'[displayCol]}${8 - displayRow}`;
      sq.dataset.square = squareName;

      // Coordinate labels (on edge squares)
      if (displayCol === (isFlipped ? 7 : 0)) {
        const rankLbl = document.createElement('span');
        rankLbl.className = 'coord-label rank';
        rankLbl.textContent = 8 - displayRow;
        sq.appendChild(rankLbl);
      }
      if (displayRow === (isFlipped ? 0 : 7)) {
        const fileLbl = document.createElement('span');
        fileLbl.className = 'coord-label file';
        fileLbl.textContent = 'abcdefgh'[displayCol];
        sq.appendChild(fileLbl);
      }

      // Highlight selected square
      if (selSquare && selSquare.row === displayRow && selSquare.col === displayCol) {
        sq.classList.add('selected');
      }

      // Highlight last move squares
      if (lastMove && !lastMove.startsWith('trap:') && lastMove.length >= 4) {
        const fSq = lastMove.substring(0, 2);
        const tSq = lastMove.substring(2, 4);
        if (squareName === fSq || squareName === tSq) {
          sq.classList.add('last-move');
        }
      }

      // Highlight sprung trap
      if (lastMove && lastMove.startsWith('trap:')) {
        const tSq = lastMove.substring(5);
        if (squareName === tSq) {
          sq.classList.add('trap');
        }
      }

      // Check highlights
      const piece = activeBoard.squares[displayRow][displayCol];
      if (piece && piece.type === PieceType.KING) {
        if ((piece.color === PieceColor.WHITE && whiteKingInCheck) ||
            (piece.color === PieceColor.BLACK && blackKingInCheck)) {
          sq.classList.add('check');
        }
      }

      // Render Piece
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece';
        pieceEl.innerHTML = getPieceSvg(piece.type, piece.color === PieceColor.WHITE);
        sq.appendChild(pieceEl);
      }

      // Legal move targets
      const isTarget = legalTargets.some(t => t.toRow === displayRow && t.toCol === displayCol);
      if (isTarget) {
        const targetMarker = document.createElement('div');
        targetMarker.className = piece ? 'move-target-capture' : 'move-target-dot';
        sq.appendChild(targetMarker);
      }

      grid.appendChild(sq);
    }
  }

  // Tint overlay for prediction phase
  const tint = document.getElementById('prediction-tint-overlay');
  const inPredictPhase = activeGame.phase === 'predict';
  const isMyTurn = (activeGame.currentTurn === 'white' && myColor === PieceColor.WHITE) ||
                   (activeGame.currentTurn === 'black' && myColor === PieceColor.BLACK);
  if (inPredictPhase && isMyTurn && reviewIndex === -1 && activeGame.status === 'active') {
    tint.classList.add('active');
  } else {
    tint.classList.remove('active');
  }
}

function updateGameHUD() {
  const banner = document.getElementById('game-turn-banner');
  if (!banner || !activeGame) return;

  if (activeGame.status === 'finished') {
    if (activeGame.result === 'white_wins') {
      banner.textContent = myColor === PieceColor.WHITE ? 'YOU WON THE MATCH!' : 'WHITE WON THE MATCH';
      banner.style.color = myColor === PieceColor.WHITE ? 'var(--accent)' : 'var(--danger)';
    } else if (activeGame.result === 'black_wins') {
      banner.textContent = myColor === PieceColor.BLACK ? 'YOU WON THE MATCH!' : 'BLACK WON THE MATCH';
      banner.style.color = myColor === PieceColor.BLACK ? 'var(--accent)' : 'var(--danger)';
    } else {
      banner.textContent = 'MATCH DRAW';
      banner.style.color = 'var(--muted)';
    }
    return;
  }

  const inPredictPhase = activeGame.phase === 'predict';
  const isMyTurn = (activeGame.currentTurn === 'white' && myColor === PieceColor.WHITE) ||
                   (activeGame.currentTurn === 'black' && myColor === PieceColor.BLACK);

  if (reviewIndex !== -1) {
    banner.textContent = `REVIEWING MOVE ${reviewIndex} OF ${(activeGame.events || []).length}`;
    banner.style.color = 'var(--muted)';
    return;
  }

  if (isMyTurn) {
    if (inPredictPhase) {
      banner.textContent = 'PREDICT MOVE';
      banner.style.color = 'var(--accent)';
    } else {
      banner.textContent = 'YOUR TURN';
      banner.style.color = 'var(--accent)';
    }
  } else {
    if (inPredictPhase) {
      banner.textContent = 'OPPONENT PREDICTING';
      banner.style.color = 'var(--muted)';
    } else {
      banner.textContent = 'OPPONENT\'S TURN';
      banner.style.color = 'var(--muted)';
    }
  }
}

function renderMoveLog() {
  const logEl = document.getElementById('game-move-log');
  if (!logEl || !activeGame) return;
  logEl.innerHTML = '';

  const events = activeGame.events || [];
  const predictions = activeGame.predictions || [];

  if (events.length === 0) {
    logEl.innerHTML = '<div style="color:var(--muted); font-size:0.8rem; padding: 12px 0;">No moves played yet</div>';
    return;
  }

  // Group events into move pairs (White / Black)
  const rows = [];
  let currentMoveNum = 1;
  let whiteMove = null;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const pred = predictions[i] || '';

    if (!whiteMove) {
      whiteMove = { event: ev, prediction: pred, index: i + 1 };
    } else {
      rows.push({
        num: currentMoveNum,
        white: whiteMove,
        black: { event: ev, prediction: pred, index: i + 1 }
      });
      whiteMove = null;
      currentMoveNum++;
    }
  }
  if (whiteMove) {
    rows.push({
      num: currentMoveNum,
      white: whiteMove,
      black: null
    });
  }

  rows.forEach(r => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'move-row';

    const numSpan = document.createElement('span');
    numSpan.className = 'move-num';
    numSpan.textContent = `${r.num}.`;
    rowDiv.appendChild(numSpan);

    const wSpan = document.createElement('span');
    wSpan.className = 'move-white';
    wSpan.innerHTML = formatEventNotation(r.white.event);
    wSpan.addEventListener('click', () => {
      reviewIndex = r.white.index;
      renderGameRoom();
    });
    rowDiv.appendChild(wSpan);

    const bSpan = document.createElement('span');
    bSpan.className = 'move-black';
    if (r.black) {
      bSpan.innerHTML = formatEventNotation(r.black.event);
      bSpan.addEventListener('click', () => {
        reviewIndex = r.black.index;
        renderGameRoom();
      });
    }
    rowDiv.appendChild(bSpan);

    logEl.appendChild(rowDiv);
  });

  // Auto-scroll to bottom if in live mode
  if (reviewIndex === -1) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function formatEventNotation(ev) {
  if (!ev) return '';
  if (ev.startsWith('trap:')) {
    return `<span class="trap-badge">TRAP ${ev.substring(5).toUpperCase()}</span>`;
  }
  return ev.toUpperCase();
}

// --- BOARD INTERACTION (Click & Drag) ---
function initBoardInteraction() {
  const grid = document.getElementById('chess-board-grid');

  grid.addEventListener('click', (e) => {
    if (!activeGame || activeGame.status !== 'active') return;
    if (reviewIndex !== -1) return;

    const sqEl = e.target.closest('.square');
    if (!sqEl) return;

    const r = parseInt(sqEl.dataset.row, 10);
    const c = parseInt(sqEl.dataset.col, 10);

    handleSquareClick(r, c);
  });
}

function handleSquareClick(row, col) {
  const inPredictPhase = activeGame.phase === 'predict';
  const isMyTurn = (activeGame.currentTurn === 'white' && myColor === PieceColor.WHITE) ||
                   (activeGame.currentTurn === 'black' && myColor === PieceColor.BLACK);

  if (!isMyTurn) return;

  const oppColor = myColor === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;
  const clickedPiece = activeBoard.squares[row][col];

  // PHASE 1: PREDICTION PHASE
  if (inPredictPhase) {
    if (selSquare) {
      // Trying to pick target square for prediction
      const targetMove = legalTargets.find(t => t.toRow === row && t.toCol === col);
      if (targetMove) {
        confirmPrediction(targetMove.toUci());
        selSquare = null;
        legalTargets = [];
        return;
      }
    }

    // Select opponent piece to predict their reply
    if (clickedPiece && clickedPiece.color === oppColor) {
      selSquare = { row, col };
      legalTargets = activeBoard.generateLegalMovesForPiece(row, col);
      renderBoardGrid();
    } else {
      selSquare = null;
      legalTargets = [];
      renderBoardGrid();
    }
    return;
  }

  // PHASE 2: NORMAL MOVE PHASE
  if (selSquare) {
    const move = legalTargets.find(t => t.toRow === row && t.toCol === col);
    if (move) {
      // Check for pawn promotion
      const piece = activeBoard.squares[selSquare.row][selSquare.col];
      const isPawnPromo = piece && piece.type === PieceType.PAWN &&
        ((piece.color === PieceColor.WHITE && row === 0) || (piece.color === PieceColor.BLACK && row === 7));

      if (isPawnPromo && !move.promotion) {
        showPromotionDialog(move);
        return;
      }

      executeMove(move.toUci());
      selSquare = null;
      legalTargets = [];
      return;
    }
  }

  // Select friendly piece to move
  if (clickedPiece && clickedPiece.color === myColor) {
    selSquare = { row, col };
    legalTargets = activeBoard.generateLegalMovesForPiece(row, col);
    renderBoardGrid();
  } else {
    selSquare = null;
    legalTargets = [];
    renderBoardGrid();
  }
}

function showPromotionDialog(baseMove) {
  promotionPendingMove = baseMove;
  const dialog = document.getElementById('promotion-dialog');
  dialog.classList.add('active');

  const isWhite = myColor === PieceColor.WHITE;
  document.getElementById('promo-q').innerHTML = getPieceSvg(PieceType.QUEEN, isWhite);
  document.getElementById('promo-r').innerHTML = getPieceSvg(PieceType.ROOK, isWhite);
  document.getElementById('promo-b').innerHTML = getPieceSvg(PieceType.BISHOP, isWhite);
  document.getElementById('promo-n').innerHTML = getPieceSvg(PieceType.KNIGHT, isWhite);

  const onSelectPromo = (promoType) => {
    dialog.classList.remove('active');
    const uci = `${promotionPendingMove.toUci()}${promoType.toLowerCase()[0]}`;
    promotionPendingMove = null;
    executeMove(uci);
  };

  document.getElementById('promo-q').onclick = () => onSelectPromo(PieceType.QUEEN);
  document.getElementById('promo-r').onclick = () => onSelectPromo(PieceType.ROOK);
  document.getElementById('promo-b').onclick = () => onSelectPromo(PieceType.BISHOP);
  document.getElementById('promo-n').onclick = () => onSelectPromo(PieceType.KNIGHT);
}

// --- EXECUTE MOVES & PREDICTIONS ---
function executeMove(uci) {
  if (!activeGame) return;

  if (activeGameMode === 'online') {
    const now = Date.now();
    activeGame.events.push(uci);
    activeGame.phase = 'predict';

    renderGameRoom();
    showToast('Move made. Predict reply.', 'info');

    // Notify opponent of our move
    roomManager.send('GAME_MOVE', {
      uci,
      whiteTimeLeft: activeGame.whiteTimeLeft,
      blackTimeLeft: activeGame.blackTimeLeft
    });
  } else if (activeGameMode === 'bot') {
    handleBotModeMove(uci);
  } else if (activeGameMode === 'pass_play') {
    handlePassPlayMove(uci);
  }
}

function confirmPrediction(uci) {
  if (!activeGame) return;

  if (activeGameMode === 'online') {
    activeGame.pendingPrediction = uci;
    activeGame.phase = 'move';
    activeGame.currentTurn = myColor === PieceColor.WHITE ? 'black' : 'white';

    renderGameRoom();
    showToast('Prediction locked.', 'success');
    SoundManager.playSound('genericnotify', 1.25);

    // Notify opponent that prediction is locked without leaking what the prediction was!
    roomManager.send('GAME_PREDICT_LOCKED', {
      whiteTimeLeft: activeGame.whiteTimeLeft,
      blackTimeLeft: activeGame.blackTimeLeft
    });
  } else if (activeGameMode === 'bot') {
    handleBotModePrediction(uci);
  } else if (activeGameMode === 'pass_play') {
    handlePassPlayPrediction(uci);
  }
}

// --- BOT GAME CONTROLLER ---
function startBotGame(elo) {
  activeGameMode = 'bot';
  activeGameId = 'offline_bot';
  myColor = PieceColor.WHITE;
  isFlipped = false;

  activeGame = {
    id: 'offline_bot',
    whiteUsername: currentUsername,
    blackUsername: `Bot (${elo} ELO)`,
    botElo: elo,
    currentTurn: 'white',
    phase: 'move',
    events: [],
    predictions: [],
    pendingPrediction: '',
    status: 'active',
    result: '',
    timerType: 'rapid_20m',
    whiteTimeLeft: 1200000,
    blackTimeLeft: 1200000,
    lastActionTime: Date.now()
  };

  enterActiveGameRoom();
}

function saveBotGame(_) {
  // Resume functionality removed: games are not persisted across navigation
}

function handleBotModeMove(uci) {
  const prediction = activeGame.pendingPrediction || '';
  if (prediction && uci === prediction) {
    // Player walked into bot's prediction
    handleBotTrap(activeGame, uci);
  } else {
    activeGame.events.push(uci);
    activeGame.predictions.push(prediction);
    activeGame.phase = 'predict';
    activeGame.pendingPrediction = '';
    saveBotGame(activeGame);
    renderGameRoom();
  }
}

function handleBotModePrediction(uci) {
  activeGame.pendingPrediction = uci;
  activeGame.phase = 'move';
  activeGame.currentTurn = 'black';
  saveBotGame(activeGame);
  renderGameRoom();
  SoundManager.playSound('genericnotify', 1.25);

  // Trigger bot reply
  triggerBotAction();
}

function handleBotTrap(game, uci) {
  const fromSquare = uci.substring(0, 2);
  const fromCol = uci.charCodeAt(0) - 'a'.charCodeAt(0);
  const fromRow = 8 - parseInt(uci[1], 10);
  const piece = activeBoard.squares[fromRow][fromCol];
  const trapEvent = `trap:${fromSquare}`;

  if (piece && piece.type === PieceType.KING) {
    game.events.push(trapEvent);
    game.predictions.push(game.pendingPrediction);
    game.status = 'finished';
    game.result = 'black_wins';
    game.pendingPrediction = '';
    saveBotGame(game);
    renderGameRoom();
    showDialog('DEFEAT', 'You moved your King into the bot\'s prediction! Game over.', [
      { text: 'Lobby', type: 'cancel', action: () => exitGameToLobby() }
    ]);
  } else {
    game.events.push(trapEvent);
    game.predictions.push(game.pendingPrediction);
    game.phase = 'move';
    game.pendingPrediction = '';
    saveBotGame(game);
    renderGameRoom();
    showToast('TRAP SPRUNG! Your piece was destroyed! Move again.', 'error');
  }
}

function getBotWorker() {
  if (!botWorker) {
    botWorker = new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' });
    botWorker.onmessage = (e) => onBotWorkerResponse(e.data);
    botWorker.onerror = () => { botRunning = false; };
  }
  return botWorker;
}

function triggerBotAction() {
  if (!activeGame || activeGame.status !== 'active') return;
  if (botRunning) return;

  const worker = getBotWorker();
  const events = [...activeGame.events];
  const elo = activeGame.botElo || 1200;

  botRunning = true;
  const reqId = ++botRequestId;

  if (activeGame.currentTurn === 'black' && activeGame.phase === 'move') {
    setTimeout(() => {
      worker.postMessage({ requestId: reqId, kind: 'move', events, elo });
    }, 400);
  } else if (activeGame.currentTurn === 'black' && activeGame.phase === 'predict') {
    setTimeout(() => {
      worker.postMessage({ requestId: reqId, kind: 'predict', events, elo });
    }, 300);
  }
}

function onBotWorkerResponse(data) {
  botRunning = false;
  if (!activeGame || activeGame.status !== 'active') return;
  const { kind, uci } = data;

  if (kind === 'move') {
    if (!uci) {
      // Checkmate or stalemate
      activeGame.status = 'finished';
      activeGame.result = 'white_wins';
      saveBotGame(activeGame);
      renderGameRoom();
      showDialog('VICTORY', 'Checkmate! You defeated the bot.', [
        { text: 'Lobby', type: 'confirm', action: () => exitGameToLobby() }
      ]);
      return;
    }

    // Did bot walk into human prediction?
    if (activeGame.pendingPrediction && uci === activeGame.pendingPrediction) {
      const fromSq = uci.substring(0, 2);
      const trapEvent = `trap:${fromSq}`;
      activeGame.events.push(trapEvent);
      activeGame.predictions.push(activeGame.pendingPrediction);
      activeGame.pendingPrediction = '';

      renderGameRoom();
      showToast('TRAP SPRUNG! The bot walked into your trap!', 'success');
      SoundManager.playSound('explosion', 1.0);

      // Bot must move again
      triggerBotAction();
    } else {
      activeGame.events.push(uci);
      activeGame.predictions.push(activeGame.pendingPrediction || '');
      activeGame.pendingPrediction = '';
      activeGame.phase = 'predict';
      saveBotGame(activeGame);
      renderGameRoom();

      // Bot predicts human's move
      triggerBotAction();
    }
  } else if (kind === 'predict') {
    activeGame.pendingPrediction = uci || '';
    activeGame.phase = 'move';
    activeGame.currentTurn = 'white';
    saveBotGame(activeGame);
    renderGameRoom();
    SoundManager.playSound('genericnotify', 1.2);
  }
}

// --- PASS & PLAY (LOCAL 2-PLAYER) ---
function startPassAndPlayGame() {
  activeGameMode = 'pass_play';
  activeGameId = 'local_pass_play';
  myColor = PieceColor.WHITE;
  isFlipped = false;

  activeGame = {
    id: 'local_pass_play',
    whiteUsername: 'Player 1 (White)',
    blackUsername: 'Player 2 (Black)',
    currentTurn: 'white',
    phase: 'move',
    events: [],
    predictions: [],
    pendingPrediction: '',
    status: 'active',
    result: '',
    timerType: 'untimed',
    whiteTimeLeft: 0,
    blackTimeLeft: 0,
    lastActionTime: Date.now()
  };

  enterActiveGameRoom();
}

function handlePassPlayMove(uci) {
  const prediction = activeGame.pendingPrediction || '';
  if (prediction && uci === prediction) {
    const fromSq = uci.substring(0, 2);
    const trapEvent = `trap:${fromSq}`;
    activeGame.events.push(trapEvent);
    activeGame.predictions.push(prediction);
    activeGame.pendingPrediction = '';

    renderGameRoom();
    showToast('TRAP SPRUNG! Piece vaporized! Player must move again.', 'error');
    SoundManager.playSound('explosion', 1.0);
  } else {
    activeGame.events.push(uci);
    activeGame.predictions.push(prediction);
    activeGame.pendingPrediction = '';
    activeGame.phase = 'predict';
    renderGameRoom();
  }
}

function handlePassPlayPrediction(uci) {
  activeGame.pendingPrediction = uci;
  activeGame.phase = 'move';

  // Switch active turn & flip board for the other player
  if (activeGame.currentTurn === 'white') {
    activeGame.currentTurn = 'black';
    myColor = PieceColor.BLACK;
    isFlipped = true;
  } else {
    activeGame.currentTurn = 'white';
    myColor = PieceColor.WHITE;
    isFlipped = false;
  }

  // Show blindfold transition so Player 2 doesn't see Player 1's secret prediction
  const passOverlay = document.getElementById('pass-play-dialog');
  const passTitle = document.getElementById('pass-play-title');
  const passBtn = document.getElementById('btn-pass-play-continue');

  if (passTitle) {
    passTitle.textContent = `PASS TO ${activeGame.currentTurn === 'white' ? 'WHITE' : 'BLACK'}`;
  }
  passOverlay.style.display = 'flex';

  passBtn.onclick = () => {
    passOverlay.style.display = 'none';
    renderGameRoom();
  };
}

// --- GAME EVENT HANDLERS (Resign, Exit, Review) ---
function initGameHandlers() {
  document.getElementById('btn-game-exit').addEventListener('click', () => {
    if (activeGame && activeGame.status === 'active') {
      showDialog('EXIT MATCH', 'Leave the current match and return to the lobby?', [
        { text: 'Leave', type: 'danger', action: () => exitGameToLobby() },
        { text: 'Cancel', type: 'cancel' }
      ]);
    } else {
      exitGameToLobby();
    }
  });

  document.getElementById('btn-game-resign').addEventListener('click', () => {
    if (!activeGame || activeGame.status !== 'active') return;
    showDialog('RESIGN MATCH', 'Are you sure you want to resign this game?', [
      {
        text: 'Resign',
        type: 'danger',
        action: () => {
          if (activeGameMode === 'online') {
            roomManager.send('GAME_RESIGN', {});
          }
          activeGame.status = 'finished';
          activeGame.result = myColor === PieceColor.WHITE ? 'black_wins' : 'white_wins';
          renderGameRoom();
          showDialog('MATCH CONCLUDED', 'You resigned the game.', [
            { text: 'Return to Lobby', type: 'confirm', action: () => exitGameToLobby() }
          ]);
        }
      },
      { text: 'Cancel', type: 'cancel' }
    ]);
  });

  // Review Navigation Controls
  document.getElementById('btn-game-first').addEventListener('click', () => {
    if (!activeGame) return;
    reviewIndex = 0;
    renderGameRoom();
  });

  document.getElementById('btn-game-prev').addEventListener('click', () => {
    if (!activeGame) return;
    const events = activeGame.events || [];
    if (reviewIndex === -1) {
      reviewIndex = Math.max(0, events.length - 1);
    } else {
      reviewIndex = Math.max(0, reviewIndex - 1);
    }
    renderGameRoom();
  });

  document.getElementById('btn-game-next').addEventListener('click', () => {
    if (!activeGame) return;
    const events = activeGame.events || [];
    if (reviewIndex !== -1) {
      if (reviewIndex >= events.length) {
        reviewIndex = -1;
      } else {
        reviewIndex++;
        if (reviewIndex >= events.length) reviewIndex = -1;
      }
    }
    renderGameRoom();
  });

  document.getElementById('btn-game-last').addEventListener('click', () => {
    reviewIndex = -1;
    renderGameRoom();
  });
}

// --- GLOBAL MODAL / DIALOG HELPER ---
function showDialog(title, message, buttons = []) {
  const overlay = document.getElementById('global-dialog');
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-message').textContent = message;

  const btnContainer = document.getElementById('dialog-buttons');
  btnContainer.innerHTML = '';

  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn-dialog ${b.type === 'danger' ? 'btn-dialog-danger' : b.type === 'cancel' ? 'btn-dialog-cancel' : 'btn-dialog-confirm'}`;
    btn.textContent = b.text;
    btn.addEventListener('click', () => {
      overlay.classList.remove('active');
      if (b.action) b.action();
    });
    btnContainer.appendChild(btn);
  });

  overlay.classList.add('active');
}

// --- GLOBAL TOAST HELPER ---
let toastTimeout = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('global-toast');
  const msgEl = document.getElementById('toast-message');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.className = `toast ${type} show`;

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// --- CHESS PIECE VECTOR SVGS (Eboshii Pearl & Obsidian Theme) ---
function getPieceSvg(type, isWhite) {
  const whiteFill = '#FDFBF7';
  const whiteStroke = '#221C2B';
  const blackFill = '#1C1527';
  const blackStroke = '#0A0710';
  const blackInnerStroke = '#E0D5C3';

  if (isWhite) {
    switch (type) {
      case PieceType.KING:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M22.5 11.63V6M20 8h5" fill="none" stroke="${whiteStroke}" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" fill="none" stroke="${whiteStroke}" stroke-width="1.6"/>
          </svg>
        `;
      case PieceType.QUEEN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0m16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none" stroke="${whiteStroke}" stroke-width="1.6"/>
          </svg>
        `;
      case PieceType.ROOK:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M9 39h27v-3H9zm3-3v-4h21v4zm-1-22V9h4v2h5V9h5v2h5V9h4v5" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="m34 14-3 3H14l-3-3" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M31 17v12.5H14V17" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="m31 29.5 1.5 2.5h-20l1.5-2.5" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M11 14h23" fill="none" stroke="${whiteStroke}" stroke-width="1.6"/>
          </svg>
        `;
      case PieceType.BISHOP:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" fill="none" stroke="${whiteStroke}" stroke-width="1.6"/>
          </svg>
        `;
      case PieceType.KNIGHT:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
            <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0" fill="${whiteStroke}" stroke="${whiteStroke}" stroke-width="1.6"/>
          </svg>
        `;
      case PieceType.PAWN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="${whiteFill}" stroke="${whiteStroke}" stroke-width="1.6"/>
          </svg>
        `;
      default: return '';
    }
  } else {
    // Black Pieces
    switch (type) {
      case PieceType.KING:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M22.5 11.6V6M20 8h5" fill="none" stroke="${blackInnerStroke}" stroke-width="1.6"/>
            <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M11.5 37a22.3 22.3 0 0 0 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M32 29.5s8.5-4 6-9.7C34.1 14 25 18 22.5 24.6v2.1-2.1C20 18 9.9 14 7 19.9c-2.5 5.6 4.8 9 4.8 9" fill="none" stroke="${blackInnerStroke}" stroke-width="1.4"/>
            <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" fill="none" stroke="${blackInnerStroke}" stroke-width="1.4"/>
          </svg>
        `;
      case PieceType.QUEEN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M6 9.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 1 1 0-5.5zm8-3a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 1 1 0-5.5zm8.5-1a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 1 1 0-5.5zm8.5 1a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 1 1 0-5.5zm8 3a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 1 1 0-5.5z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.5"/>
            <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M11 29a35 35 1 0 1 23 0m-21.5 2.5h20m-21 3a35 35 1 0 0 22 0" fill="none" stroke="${blackInnerStroke}" stroke-width="1.4"/>
          </svg>
        `;
      case PieceType.ROOK:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M9 39h27v-3H9zm3.5-7 1.5-2.5h17l1.5 2.5zm-.5 4v-4h21v4z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M14 29.5v-13h17v13z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M14 16.5 11 14h23l-3 2.5zM11 14V9h4v2h5V9h5v2h5V9h4v5z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M12 35.5h21m-20-4h19m-18-2h17m-17-13h17" fill="none" stroke="${blackInnerStroke}" stroke-width="1.4"/>
          </svg>
        `;
      case PieceType.BISHOP:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M9 36c3.4-1 10.1.4 13.5-2 3.4 2.4 10.1 1 13.5 2 0 0 1.6.5 3 2-.7 1-1.6 1-3 .5-3.4-1-10.1.5-13.5-1-3.4 1.5-10.1 0-13.5 1-1.4.5-2.3.5-3-.5 1.4-2 3-2 3-2z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" fill="none" stroke="${blackInnerStroke}" stroke-width="1.4"/>
          </svg>
        `;
      case PieceType.KNIGHT:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
            <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0" fill="${blackInnerStroke}" stroke="${blackInnerStroke}" stroke-width="1.6"/>
            <path d="m24.55 10.4-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39" fill="none" stroke="${blackInnerStroke}" stroke-width="1.4"/>
          </svg>
        `;
      case PieceType.PAWN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%">
            <path d="M22.5 9a4 4 0 0 0-3.22 6.38 6.48 6.48 0 0 0-.87 10.65c-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47a6.46 6.46 0 0 0-.87-10.65A4.01 4.01 0 0 0 22.5 9z" fill="${blackFill}" stroke="${blackStroke}" stroke-width="1.6"/>
          </svg>
        `;
      default: return '';
    }
  }
}
