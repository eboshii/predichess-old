# Predichess Web Client

A tactical chess variant web client stylised after **[eboshii.dev](https://eboshii.github.io/)**, featuring hidden move predictions, piece destruction mechanics, and instant 2-player matches with 5-character invite codes.

## ⚔️ Game Mechanics: Predict & Obliterate
*   **Traditional Foundations:** Standard chess movements, promotions, castling, and en passant rules apply.
*   **The Secret Prediction:** Immediately after each move, the player secretly wagers on the exact piece and destination square the opponent will choose next.
*   **Springing the Trap:** If the opponent makes the predicted move, their piece is instantly destroyed and vaporized! They forfeit that piece and must make another move.
*   **King Trap Sudden Death:** Successfully predicting the opponent King's move vaporizes their King for an immediate victory!

## ✨ Visuals & eboshii.dev Theme
*   **Retro Cosmic Design Tokens:** Deep cosmic obsidian background (`#05030a`), warm ivory typography (`#F5F0E8`), sand muted accents (`#B3A898`), and warm retro gold highlights (`#F0B365`).
*   **WebGL Nebula Shader:** Fullscreen real-time dithered pixelated starfield background ported directly from `eboshii.dev` with fallback poster support.
*   **Translucent Glass Surfaces:** Header and cards rendered with subtle ivory/gold borders and backdrop blur.
*   **Antique Ivory & Cosmic Slate Chessboard:** Custom square colors (`#D6CEBD` and `#382A4F`) with glowing gold selection outlines, check warnings, and animated explosive shockwaves for sprung traps.
*   **Vector Chess Pieces:** Tailored pearl-white and obsidian-violet chess vectors matching the cosmic palette.

## 🎮 Gameplay Modes (Zero Login Required)
1.  **Online 2-Player (5-Character Invite Codes):**
    *   Click **Create 2-Player Game** to generate an instant 5-character room code (e.g. `K9X2B`).
    *   Share the code or 1-click invite link (`https://eboshii.github.io/predichess/?code=K9X2B`).
    *   The opponent enters the code or opens the link to join immediately—no accounts, no passwords, no Google login required.
    *   Synchronized in real time via redundant WebSocket pub/sub (MQTT) and WebRTC DataChannel (PeerJS).
2.  **Practice vs Offline Bot:**
    *   Challenge a client-side AI engine powered by a background web worker.
    *   Selectable ELO ratings: 800 (Novice), 1200 (Medium), 1600 (Hard), 2000 (Expert).
    *   Full offline auto-save and resume capability.
3.  **Pass & Play (Local 2-Player):**
    *   Play on the same screen taking turns, with a blindfold transition overlay to conceal secret predictions.

## 📂 Project Structure
*   `index.html` — Document layout, sticky eboshii header, lobby mode cards, chessboard deck, and dialogs.
*   `styles.css` — CSS design tokens, typography scale (`Space Grotesk`, `Inter`, `EB Garamond`, `JetBrains Mono`), glassmorphic panels, and board styles.
*   `app.js` — Core game controller, coordinate conversions, drag-and-drop actions, review navigation (`⏮`, `◀`, `▶`, `LIVE`), HUD banners, and bot loop.
*   `network.js` — Zero-backend multiplayer manager handling room codes, WebRTC (PeerJS), and MQTT over WebSocket with automatic fallback.
*   `bot-worker.js` — Minimax bot engine running off the main thread.
*   `chess.js` — Custom chess engine modeling movement validation and Predichess trap rules.
*   `assets/` — WebGL nebula shader (`nebula-bg.js`) and poster image (`nebula-poster.webp`).
*   `sounds/` — Audio assets for moves, captures, explosions, time warnings, and notifications.

## 🚀 Easy Hosting on GitHub Pages
This repository is completely static and serverless:
1. Push to your repository:
   ```bash
   git add .
   git commit -m "feat: redesign after eboshii.dev and implement 5-letter code multiplayer"
   git push origin main
   ```
2. In GitHub repository **Settings** -> **Pages**, set **Source** to `Deploy from a branch` (`main`, `/ (root)`).
3. The site will be live at `https://your-username.github.io/predichess/`!
