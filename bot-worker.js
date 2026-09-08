// bot-worker.js — Offline bot engine running off the main thread.
//
// The minimax search in BotEngine.getBestMove is synchronous and, at higher
// ELO/depth, can take several seconds. Running it on the main thread froze the
// UI and the clock ("Waiting for bot" with the bot's timer stuck). This module
// worker runs the search in the background so the page stays responsive.
//
// Protocol:
//   in :  { requestId, kind: 'move' | 'predict', events: string[], elo: number }
//   out:  { requestId, kind, uci: string, error?: string }
//
// The board is rebuilt from the game's `events` list via ChessBoard.applyMoves,
// which is exactly how the main thread reconstructs `activeBoard`, so the
// position the engine sees is identical.

import { ChessBoard, PieceColor, BotEngine } from './chess.js';

self.onmessage = (e) => {
  const { requestId, kind, events, elo } = e.data || {};
  try {
    const board = new ChessBoard();
    board.applyMoves(events || []);

    let uci = '';
    if (kind === 'predict') {
      // Bot predicts White's (the human player's) next move.
      uci = BotEngine.getWeightedPrediction(board, PieceColor.WHITE, elo, events) || '';
    } else {
      // Bot plays Black's move.
      const move = BotEngine.getBestMove(board, PieceColor.BLACK, elo, events);
      uci = move ? move.toUci() : '';
    }

    self.postMessage({ requestId, kind, uci });
  } catch (err) {
    self.postMessage({ requestId, kind, uci: '', error: String(err) });
  }
};
