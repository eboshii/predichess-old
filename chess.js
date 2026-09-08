// Chess.js - Self-contained custom chess engine matching Kotlin board logic
// Includes standard movements, castling, en passant, promotion, checks, draw rules,
// and the special Predichess 'trap' mechanism.

export const PieceType = {
  KING: 'KING',
  QUEEN: 'QUEEN',
  ROOK: 'ROOK',
  BISHOP: 'BISHOP',
  KNIGHT: 'KNIGHT',
  PAWN: 'PAWN'
};

export const PieceColor = {
  WHITE: 'WHITE',
  BLACK: 'BLACK'
};

export const GameResult = {
  ONGOING: 'ONGOING',
  CHECKMATE_WHITE_WINS: 'CHECKMATE_WHITE_WINS',
  CHECKMATE_BLACK_WINS: 'CHECKMATE_BLACK_WINS',
  STALEMATE: 'STALEMATE',
  DRAW_FIFTY_MOVE: 'DRAW_FIFTY_MOVE',
  DRAW_THREEFOLD: 'DRAW_THREEFOLD',
  DRAW_INSUFFICIENT: 'DRAW_INSUFFICIENT'
};

export class ChessMove {
  constructor(fromRow, fromCol, toRow, toCol, promotion = null) {
    this.fromRow = fromRow;
    this.fromCol = fromCol;
    this.toRow = toRow;
    this.toCol = toCol;
    this.promotion = promotion; // PieceType
  }

  toUci() {
    const files = 'abcdefgh';
    const promoChar = this.promotion ? {
      [PieceType.QUEEN]: 'q',
      [PieceType.ROOK]: 'r',
      [PieceType.BISHOP]: 'b',
      [PieceType.KNIGHT]: 'n'
    }[this.promotion] : '';
    return `${files[this.fromCol]}${8 - this.fromRow}${files[this.toCol]}${8 - this.toRow}${promoChar}`;
  }
}

export class ChessBoard {
  constructor() {
    this.squares = Array(8).fill(null).map(() => Array(8).fill(null));
    this.castlingRights = [true, true, true, true]; // [WK, WQ, BK, BQ]
    this.enPassantTarget = null; // {row, col}
    this.halfMoveClock = 0;
    this.currentTurn = PieceColor.WHITE;
    this.positionHistory = {}; // positionKey -> count
    this.reset();
  }

  reset() {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        this.squares[r][c] = null;
      }
    }

    const backRow = [
      PieceType.ROOK, PieceType.KNIGHT, PieceType.BISHOP, PieceType.QUEEN,
      PieceType.KING, PieceType.BISHOP, PieceType.KNIGHT, PieceType.ROOK
    ];

    for (let c = 0; c < 8; c++) {
      this.squares[0][c] = { type: backRow[c], color: PieceColor.BLACK };
      this.squares[1][c] = { type: PieceType.PAWN, color: PieceColor.BLACK };
      this.squares[6][c] = { type: PieceType.PAWN, color: PieceColor.WHITE };
      this.squares[7][c] = { type: backRow[c], color: PieceColor.WHITE };
    }

    this.castlingRights = [true, true, true, true];
    this.enPassantTarget = null;
    this.halfMoveClock = 0;
    this.currentTurn = PieceColor.WHITE;
    this.positionHistory = {};
    this.positionHistory[this.positionKey()] = 1;
  }

  applyMoves(events) {
    this.reset();
    events.forEach(event => {
      if (event.startsWith('trap:')) {
        this.applyTrap(event.substring(5));
      } else {
        this.applyMove(event);
      }
    });
  }

  applyMove(uci) {
    const move = this.parseUci(uci);
    if (move) {
      this.applyChessMove(move);
    }
  }

  applyTrap(fromSquare) {
    if (fromSquare.length < 2) return;
    const col = fromSquare.charCodeAt(0) - 'a'.charCodeAt(0);
    const row = 8 - parseInt(fromSquare[1], 10);
    if (row >= 0 && row < 8 && col >= 0 && col < 8) {
      this.squares[row][col] = null;
    }
    this.halfMoveClock = 0;
    const key = this.positionKey();
    this.positionHistory[key] = (this.positionHistory[key] || 0) + 1;
  }

  parseUci(uci) {
    if (uci.length < 4) return null;
    const fc = uci.charCodeAt(0) - 'a'.charCodeAt(0);
    const fr = 8 - parseInt(uci[1], 10);
    const tc = uci.charCodeAt(2) - 'a'.charCodeAt(0);
    const tr = 8 - parseInt(uci[3], 10);
    
    let promo = null;
    if (uci.length >= 5) {
      const char = uci[4].toLowerCase();
      if (char === 'q') promo = PieceType.QUEEN;
      else if (char === 'r') promo = PieceType.ROOK;
      else if (char === 'b') promo = PieceType.BISHOP;
      else if (char === 'n') promo = PieceType.KNIGHT;
    }
    return new ChessMove(fr, fc, tr, tc, promo);
  }

  applyChessMove(move) {
    const piece = this.squares[move.fromRow][move.fromCol];
    if (!piece) return;

    const isCapture = this.squares[move.toRow][move.toCol] !== null;
    const epTarget = this.enPassantTarget;
    const isEnPassant = piece.type === PieceType.PAWN && epTarget &&
                        move.toRow === epTarget.row && move.toCol === epTarget.col;
    const isCastle = piece.type === PieceType.KING && Math.abs(move.toCol - move.fromCol) === 2;

    if (piece.type === PieceType.PAWN || isCapture || isEnPassant) {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock++;
    }

    if (piece.type === PieceType.PAWN && Math.abs(move.toRow - move.fromRow) === 2) {
      this.enPassantTarget = {
        row: Math.floor((move.fromRow + move.toRow) / 2),
        col: move.fromCol
      };
    } else {
      this.enPassantTarget = null;
    }

    // Update castling rights
    if (piece.type === PieceType.KING) {
      if (piece.color === PieceColor.WHITE) {
        this.castlingRights[0] = false;
        this.castlingRights[1] = false;
      } else {
        this.castlingRights[2] = false;
        this.castlingRights[3] = false;
      }
    }

    if (piece.type === PieceType.ROOK) {
      if (move.fromRow === 7 && move.fromCol === 7) this.castlingRights[0] = false;
      if (move.fromRow === 7 && move.fromCol === 0) this.castlingRights[1] = false;
      if (move.fromRow === 0 && move.fromCol === 7) this.castlingRights[2] = false;
      if (move.fromRow === 0 && move.fromCol === 0) this.castlingRights[3] = false;
    }

    // Castling rook captured
    if (move.toRow === 7 && move.toCol === 7) this.castlingRights[0] = false;
    if (move.toRow === 7 && move.toCol === 0) this.castlingRights[1] = false;
    if (move.toRow === 0 && move.toCol === 7) this.castlingRights[2] = false;
    if (move.toRow === 0 && move.toCol === 0) this.castlingRights[3] = false;

    // Move the piece (handles promotion)
    this.squares[move.toRow][move.toCol] = move.promotion ? 
      { type: move.promotion, color: piece.color } : piece;
    this.squares[move.fromRow][move.fromCol] = null;

    if (isEnPassant) {
      const capturedRow = piece.color === PieceColor.WHITE ? move.toRow + 1 : move.toRow - 1;
      this.squares[capturedRow][move.toCol] = null;
    }

    if (isCastle) {
      if (move.toCol === 6) { // Kingside
        this.squares[move.toRow][5] = this.squares[move.toRow][7];
        this.squares[move.toRow][7] = null;
      } else { // Queenside
        this.squares[move.toRow][3] = this.squares[move.toRow][0];
        this.squares[move.toRow][0] = null;
      }
    }

    this.currentTurn = this.opponent(this.currentTurn);
    const key = this.positionKey();
    this.positionHistory[key] = (this.positionHistory[key] || 0) + 1;
  }

  opponent(color) {
    return color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;
  }

  isInCheck(color) {
    const king = this.findKing(color);
    if (!king) return false;
    return this.isAttackedBy(king.row, king.col, this.opponent(color));
  }

  findKing(color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.squares[r][c];
        if (p && p.type === PieceType.KING && p.color === color) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  getAttackers(row, col, byColor) {
    const attackers = [];

    // Knights
    const knightOffsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightOffsets) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p && p.color === byColor && p.type === PieceType.KNIGHT) {
          attackers.push({ row: r, col: c, piece: p });
        }
      }
    }

    // King
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const p = this.squares[r][c];
          if (p && p.color === byColor && p.type === PieceType.KING) {
            attackers.push({ row: r, col: c, piece: p });
          }
        }
      }
    }

    // Pawns
    const pawnDir = byColor === PieceColor.WHITE ? 1 : -1;
    for (const dc of [-1, 1]) {
      const r = row + pawnDir;
      const c = col + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p && p.color === byColor && p.type === PieceType.PAWN) {
          attackers.push({ row: r, col: c, piece: p });
        }
      }
    }

    // Rooks / Queens (Orthogonal)
    const orthoDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of orthoDirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p) {
          if (p.color === byColor && (p.type === PieceType.ROOK || p.type === PieceType.QUEEN)) {
            attackers.push({ row: r, col: c, piece: p });
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    // Bishops / Queens (Diagonal)
    const diagDirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dr, dc] of diagDirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (p) {
          if (p.color === byColor && (p.type === PieceType.BISHOP || p.type === PieceType.QUEEN)) {
            attackers.push({ row: r, col: c, piece: p });
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    return attackers;
  }

  isAttackedBy(row, col, byColor) {
    return this.getAttackers(row, col, byColor).length > 0;
  }

  legalMovesFrom(row, col) {
    const piece = this.squares[row][col];
    if (!piece) return [];
    return this.pseudoFrom(row, col, piece).filter(move => {
      const c = this.copy();
      c.applyChessMove(move);
      return !c.isInCheck(piece.color);
    });
  }

  legalMoves(color) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.squares[r][c] && this.squares[r][c].color === color) {
          moves.push(...this.legalMovesFrom(r, c));
        }
      }
    }
    return moves;
  }

  pseudoFrom(row, col, piece) {
    switch (piece.type) {
      case PieceType.PAWN:
        return this.pawnMoves(row, col, piece.color);
      case PieceType.KNIGHT:
        return this.knightMoves(row, col, piece.color);
      case PieceType.BISHOP:
        return this.sliding(row, col, piece.color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
      case PieceType.ROOK:
        return this.sliding(row, col, piece.color, [[0, 1], [0, -1], [1, 0], [-1, 0]]);
      case PieceType.QUEEN:
        return this.sliding(row, col, piece.color, [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
      case PieceType.KING:
        return this.kingMoves(row, col, piece.color);
      default:
        return [];
    }
  }

  pawnMoves(row, col, color) {
    const moves = [];
    const dir = color === PieceColor.WHITE ? -1 : 1;
    const startRow = color === PieceColor.WHITE ? 6 : 1;
    const promoRow = color === PieceColor.WHITE ? 0 : 7;

    const add = (tr, tc) => {
      if (tr === promoRow) {
        for (const p of [PieceType.QUEEN, PieceType.ROOK, PieceType.BISHOP, PieceType.KNIGHT]) {
          moves.push(new ChessMove(row, col, tr, tc, p));
        }
      } else {
        moves.push(new ChessMove(row, col, tr, tc));
      }
    };

    const r1 = row + dir;
    if (r1 >= 0 && r1 < 8 && this.squares[r1][col] === null) {
      add(r1, col);
      if (row === startRow && this.squares[row + 2 * dir][col] === null) {
        moves.push(new ChessMove(row, col, row + 2 * dir, col));
      }
    }

    for (const dc of [-1, 1]) {
      const c = col + dc;
      if (r1 >= 0 && r1 < 8 && c >= 0 && c < 8) {
        const target = this.squares[r1][c];
        const ep = this.enPassantTarget && this.enPassantTarget.row === r1 && this.enPassantTarget.col === c;
        if ((target && target.color !== color) || ep) {
          add(r1, c);
        }
      }
    }
    return moves;
  }

  knightMoves(row, col, color) {
    const moves = [];
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of offsets) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = this.squares[r][c];
        if (!p || p.color !== color) {
          moves.push(new ChessMove(row, col, r, c));
        }
      }
    }
    return moves;
  }

  sliding(row, col, color, dirs) {
    const moves = [];
    for (const [dr, dc] of dirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = this.squares[r][c];
        if (target === null) {
          moves.push(new ChessMove(row, col, r, c));
        } else {
          if (target.color !== color) {
            moves.push(new ChessMove(row, col, r, c));
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }
    return moves;
  }

  kingMoves(row, col, color) {
    const moves = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const p = this.squares[r][c];
          if (!p || p.color !== color) {
            moves.push(new ChessMove(row, col, r, c));
          }
        }
      }
    }

    const rank = color === PieceColor.WHITE ? 7 : 0;
    const oppColor = this.opponent(color);
    const ksRight = color === PieceColor.WHITE ? this.castlingRights[0] : this.castlingRights[2];
    const qsRight = color === PieceColor.WHITE ? this.castlingRights[1] : this.castlingRights[3];

    if (row === rank && col === 4 && !this.isInCheck(color)) {
      if (ksRight && this.squares[rank][5] === null && this.squares[rank][6] === null &&
          !this.isAttackedBy(rank, 5, oppColor) && !this.isAttackedBy(rank, 6, oppColor)) {
        moves.push(new ChessMove(row, col, rank, 6));
      }
      if (qsRight && this.squares[rank][3] === null && this.squares[rank][2] === null && this.squares[rank][1] === null &&
          !this.isAttackedBy(rank, 3, oppColor) && !this.isAttackedBy(rank, 2, oppColor)) {
        moves.push(new ChessMove(row, col, rank, 2));
      }
    }
    return moves;
  }

  gameResult() {
    if (this.findKing(PieceColor.WHITE) === null) return GameResult.CHECKMATE_BLACK_WINS;
    if (this.findKing(PieceColor.BLACK) === null) return GameResult.CHECKMATE_WHITE_WINS;
    
    if (Object.values(this.positionHistory).some(v => v >= 3)) return GameResult.DRAW_THREEFOLD;
    if (this.halfMoveClock >= 100) return GameResult.DRAW_FIFTY_MOVE;
    if (this.isInsufficientMaterial()) return GameResult.DRAW_INSUFFICIENT;

    if (this.legalMoves(this.currentTurn).length === 0) {
      if (this.isInCheck(this.currentTurn)) {
        return this.currentTurn === PieceColor.WHITE ? 
          GameResult.CHECKMATE_BLACK_WINS : GameResult.CHECKMATE_WHITE_WINS;
      } else {
        return GameResult.STALEMATE;
      }
    }
    return GameResult.ONGOING;
  }

  isInsufficientMaterial() {
    const all = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.squares[r][c]) all.push(this.squares[r][c]);
      }
    }

    if (all.length === 2) return true; // Kings only
    if (all.length === 3 && all.some(p => p.type === PieceType.KNIGHT || p.type === PieceType.BISHOP)) return true;
    
    if (all.length === 4) {
      const bishops = all.filter(p => p.type === PieceType.BISHOP);
      if (bishops.length === 2 && bishops[0].color !== bishops[1].color) {
        const pos = [];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (this.squares[r][c] && this.squares[r][c].type === PieceType.BISHOP) {
              pos.push({ r, c });
            }
          }
        }
        if (pos.length === 2 && (pos[0].r + pos[0].c) % 2 === (pos[1].r + pos[1].c) % 2) {
          return true;
        }
      }
    }
    return false;
  }

  positionKey() {
    const sb = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.squares[r][c];
        if (!p) {
          sb.push('.');
        } else {
          const isWhite = p.color === PieceColor.WHITE;
          const char = {
            [PieceType.KING]: 'k',
            [PieceType.QUEEN]: 'q',
            [PieceType.ROOK]: 'r',
            [PieceType.BISHOP]: 'b',
            [PieceType.KNIGHT]: 'n',
            [PieceType.PAWN]: 'p'
          }[p.type];
          sb.push(isWhite ? char.toUpperCase() : char.toLowerCase());
        }
      }
    }
    sb.push(this.currentTurn === PieceColor.WHITE ? 'w' : 'b');
    this.castlingRights.forEach(r => sb.push(r ? '1' : '0'));
    if (this.enPassantTarget) {
      sb.push(`${this.enPassantTarget.row}${this.enPassantTarget.col}`);
    } else {
      sb.push('-');
    }
    return sb.join('');
  }

  copy() {
    const c = new ChessBoard();
    for (let r = 0; r < 8; r++) {
      for (let col = 0; col < 8; col++) {
        c.squares[r][col] = this.squares[r][col];
      }
    }
    c.castlingRights = [...this.castlingRights];
    c.enPassantTarget = this.enPassantTarget ? { ...this.enPassantTarget } : null;
    c.halfMoveClock = this.halfMoveClock;
    c.currentTurn = this.currentTurn;
    c.positionHistory = {};
    return c;
  }
}

const PIECE_VALUES = {
  [PieceType.PAWN]: 100,
  [PieceType.KNIGHT]: 320,
  [PieceType.BISHOP]: 330,
  [PieceType.ROOK]: 500,
  [PieceType.QUEEN]: 900,
  [PieceType.KING]: 20000
};

const PAWN_TABLE = [
  0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5,  5, 10, 25, 25, 10,  5,  5,
  0,  0,  0, 20, 20,  0,  0,  0,
  5, -5,-10,  0,  0,-10, -5,  5,
  5, 10, 10,-20,-20, 10, 10,  5,
  0,  0,  0,  0,  0,  0,  0,  0
];

const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50
];

const BISHOP_TABLE = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20
];

const ROOK_TABLE = [
  0,  0,  0,  0,  0,  0,  0,  0,
  5, 10, 10, 10, 10, 10, 10,  5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
 -5,  0,  0,  0,  0,  0,  0, -5,
  0,  0,  0,  5,  5,  0,  0,  0
];

export const BotEngine = {
  isAbsoluteStartingPosition(board) {
    const backRow = [
      PieceType.ROOK, PieceType.KNIGHT, PieceType.BISHOP, PieceType.QUEEN,
      PieceType.KING, PieceType.BISHOP, PieceType.KNIGHT, PieceType.ROOK
    ];
    for (let c = 0; c < 8; c++) {
      const p = board.squares[0][c];
      if (!p || p.type !== backRow[c] || p.color !== PieceColor.BLACK) return false;
      const pawn = board.squares[1][c];
      if (!pawn || pawn.type !== PieceType.PAWN || pawn.color !== PieceColor.BLACK) return false;
    }
    for (let r = 2; r <= 5; r++) {
      for (let c = 0; c < 8; c++) {
        if (board.squares[r][c] !== null) return false;
      }
    }
    for (let c = 0; c < 8; c++) {
      const pawn = board.squares[6][c];
      if (!pawn || pawn.type !== PieceType.PAWN || pawn.color !== PieceColor.WHITE) return false;
      const p = board.squares[7][c];
      if (!p || p.type !== backRow[c] || p.color !== PieceColor.WHITE) return false;
    }
    return true;
  },

  isBlackFirstMove(board) {
    if (board.currentTurn !== PieceColor.BLACK) return false;
    const backRow = [
      PieceType.ROOK, PieceType.KNIGHT, PieceType.BISHOP, PieceType.QUEEN,
      PieceType.KING, PieceType.BISHOP, PieceType.KNIGHT, PieceType.ROOK
    ];
    for (let c = 0; c < 8; c++) {
      const p = board.squares[0][c];
      if (!p || p.type !== backRow[c] || p.color !== PieceColor.BLACK) return false;
      const pawn = board.squares[1][c];
      if (!pawn || pawn.type !== PieceType.PAWN || pawn.color !== PieceColor.BLACK) return false;
    }
    let whitePiecesInMiddle = 0;
    for (let r = 2; r <= 5; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board.squares[r][c];
        if (p) {
          if (p.color !== PieceColor.WHITE) return false;
          whitePiecesInMiddle++;
        }
      }
    }
    return whitePiecesInMiddle === 1;
  },

  evaluateBoard(board) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board.squares[r][c];
        if (!piece) continue;
        const valBase = PIECE_VALUES[piece.type] || 0;
        
        const tableIndex = piece.color === PieceColor.WHITE ? (7 - r) * 8 + c : r * 8 + c;
        let posBonus = 0;
        if (piece.type === PieceType.PAWN) posBonus = PAWN_TABLE[tableIndex];
        else if (piece.type === PieceType.KNIGHT) posBonus = KNIGHT_TABLE[tableIndex];
        else if (piece.type === PieceType.BISHOP) posBonus = BISHOP_TABLE[tableIndex];
        else if (piece.type === PieceType.ROOK) posBonus = ROOK_TABLE[tableIndex];

        // --- Predichess Tactical Heuristic: Bait-and-Vaporize Multi-Threats ---
        // An aggressive piece placed where exactly 1 enemy piece attacks it,
        // but it threatens 2+ enemy pieces (or King/Queen).
        // In Predichess, this is lethal because the attacker's sole capture can be predicted and vaporized!
        if (r >= 1 && r <= 6 && piece.type !== PieceType.KING) {
          const oppCol = board.opponent(piece.color);
          const attackers = board.getAttackers(r, c, oppCol);
          if (attackers.length === 1) {
            let targetCount = 0;
            let attacksKingOrQueen = false;
            const pseudo = board.pseudoFrom(r, c, piece);
            for (let i = 0; i < pseudo.length; i++) {
              const tr = pseudo[i].toRow;
              const tc = pseudo[i].toCol;
              const targetPiece = board.squares[tr][tc];
              if (targetPiece && targetPiece.color === oppCol) {
                targetCount++;
                if (targetPiece.type === PieceType.KING || targetPiece.type === PieceType.QUEEN) {
                  attacksKingOrQueen = true;
                }
              }
            }
            if (attacksKingOrQueen && targetCount >= 2) {
              posBonus += 700;
            } else if (targetCount >= 2) {
              posBonus += 450;
            } else if (attacksKingOrQueen) {
              posBonus += 300;
            }
          }
        }

        const totalVal = valBase + posBonus;
        if (piece.color === PieceColor.WHITE) {
          score += totalVal;
        } else {
          score -= totalVal;
        }
      }
    }

    // --- Predichess Tactical Heuristic: King Snipe Bottlenecks ---
    // If White is in check, count White's legal moves (evasions).
    if (board.isInCheck(PieceColor.WHITE)) {
      const wMoves = board.legalMoves(PieceColor.WHITE);
      if (wMoves.length === 1) {
        // White King has only 1 legal evasion: 100% lethal snipe hazard
        score -= 6000;
      } else if (wMoves.length === 2) {
        score -= 1800;
      } else if (wMoves.length === 3) {
        score -= 600;
      }
    }

    // If Black is in check, count Black's legal moves (evasions).
    if (board.isInCheck(PieceColor.BLACK)) {
      const bMoves = board.legalMoves(PieceColor.BLACK);
      if (bMoves.length === 1) {
        // Black King has only 1 legal evasion: 100% lethal snipe hazard
        score += 6000;
      } else if (bMoves.length === 2) {
        score += 1800;
      } else if (bMoves.length === 3) {
        score += 600;
      }
    }

    return score;
  },

  minimax(board, depth, alpha, beta, isMaximizing, elo = 1600) {
    const result = board.gameResult();
    if (result !== GameResult.ONGOING) {
      if (result === GameResult.CHECKMATE_WHITE_WINS) return [100000 + depth, null];
      if (result === GameResult.CHECKMATE_BLACK_WINS) return [-100000 - depth, null];
      return [0, null]; // Draws
    }

    if (depth === 0) {
      return [this.evaluateBoard(board), null];
    }

    const turn = isMaximizing ? PieceColor.WHITE : PieceColor.BLACK;
    const moves = board.legalMoves(turn);

    if (moves.length === 0) {
      return [isMaximizing ? -100000 : 100000, null];
    }

    // Enhanced move ordering: MVV-LVA captures first to maximize alpha-beta cutoffs
    const orderedMoves = [...moves].sort((mA, mB) => {
      const targetA = board.squares[mA.toRow][mA.toCol];
      const targetB = board.squares[mB.toRow][mB.toCol];
      const pieceA = board.squares[mA.fromRow][mA.fromCol];
      const pieceB = board.squares[mB.fromRow][mB.fromCol];
      let priorityA = 0;
      let priorityB = 0;
      if (targetA) {
        priorityA = (PIECE_VALUES[targetA.type] || 0) * 10 - (pieceA ? (PIECE_VALUES[pieceA.type] || 0) : 0);
      }
      if (targetB) {
        priorityB = (PIECE_VALUES[targetB.type] || 0) * 10 - (pieceB ? (PIECE_VALUES[pieceB.type] || 0) : 0);
      }
      return priorityB - priorityA;
    });

    let bestMove = null;
    if (isMaximizing) {
      let maxEval = -Infinity;
      let currentAlpha = alpha;
      for (const move of orderedMoves) {
        const nextBoard = board.copy();
        nextBoard.applyChessMove(move);
        const [evalVal] = this.minimax(nextBoard, depth - 1, currentAlpha, beta, false, elo);
        if (evalVal > maxEval) {
          maxEval = evalVal;
          bestMove = move;
        }
        currentAlpha = Math.max(currentAlpha, evalVal);
        if (beta <= currentAlpha) break;
      }
      return [maxEval, bestMove];
    } else {
      let minEval = Infinity;
      let currentBeta = beta;
      for (const move of orderedMoves) {
        const nextBoard = board.copy();
        nextBoard.applyChessMove(move);
        const [evalVal] = this.minimax(nextBoard, depth - 1, alpha, currentBeta, true, elo);
        if (evalVal < minEval) {
          minEval = evalVal;
          bestMove = move;
        }
        currentBeta = Math.min(currentBeta, evalVal);
        if (currentBeta <= alpha) break;
      }
      return [minEval, bestMove];
    }
  },

  getBestMove(board, color, elo = 1600, events = []) {
    const isMaximizing = color === PieceColor.WHITE;
    const oppColor = board.opponent(color);
    const legal = board.legalMoves(color);
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    // Check for standard opening book play on move 1
    if (color === PieceColor.WHITE && this.isAbsoluteStartingPosition(board)) {
      const whiteOpenings = [
        { uci: "e2e4", weight: 35 },
        { uci: "d2d4", weight: 30 },
        { uci: "c2c4", weight: 10 },
        { uci: "g1f3", weight: 10 },
        { uci: "f2f4", weight: 5 },
        { uci: "b2b3", weight: 4 },
        { uci: "g2g3", weight: 3 },
        { uci: "e2e3", weight: 3 }
      ];
      const total = whiteOpenings.reduce((acc, o) => acc + o.weight, 0);
      let r = Math.random() * total;
      for (const op of whiteOpenings) {
        r -= op.weight;
        if (r <= 0) {
          const move = board.parseUci(op.uci);
          if (move && legal.some(l => l.fromRow === move.fromRow && l.fromCol === move.fromCol && l.toRow === move.toRow && l.toCol === move.toCol)) {
            return move;
          }
        }
      }
    }

    if (color === PieceColor.BLACK && this.isBlackFirstMove(board)) {
      let whiteMoveUci = "";
      for (let r = 2; r <= 5; r++) {
        for (let c = 0; c < 8; c++) {
          if (board.squares[r][c] && board.squares[r][c].color === PieceColor.WHITE) {
            const files = 'abcdefgh';
            whiteMoveUci = `${files[c]}${8 - r}`;
          }
        }
      }

      let replies = [];
      if (whiteMoveUci === "e4") {
        replies = [
          { uci: "c7c5", weight: 35 },
          { uci: "e7e5", weight: 30 },
          { uci: "e7e6", weight: 15 },
          { uci: "c7c6", weight: 10 },
          { uci: "d7d5", weight: 4 },
          { uci: "d7d6", weight: 3 },
          { uci: "g7g6", weight: 2 },
          { uci: "b8c6", weight: 1 }
        ];
      } else if (whiteMoveUci === "d4") {
        replies = [
          { uci: "d7d5", weight: 40 },
          { uci: "g8f6", weight: 35 },
          { uci: "e7e6", weight: 10 },
          { uci: "c7c5", weight: 5 },
          { uci: "f7f5", weight: 4 },
          { uci: "g7g6", weight: 3 },
          { uci: "d7d6", weight: 2 },
          { uci: "c7c6", weight: 1 }
        ];
      } else {
        replies = [
          { uci: "d7d5", weight: 30 },
          { uci: "g8f6", weight: 30 },
          { uci: "e7e5", weight: 20 },
          { uci: "c7c5", weight: 10 },
          { uci: "e7e6", weight: 4 },
          { uci: "g7g6", weight: 3 },
          { uci: "c7c6", weight: 2 },
          { uci: "d7d6", weight: 1 }
        ];
      }

      const total = replies.reduce((acc, o) => acc + o.weight, 0);
      let r = Math.random() * total;
      for (const op of replies) {
        r -= op.weight;
        if (r <= 0) {
          const move = board.parseUci(op.uci);
          if (move && legal.some(l => l.fromRow === move.fromRow && l.fromCol === move.fromCol && l.toRow === move.toRow && l.toCol === move.toCol)) {
            return move;
          }
        }
      }
    }

    // Dynamic ELO configurations
    let depth;
    let blunderChance;
    if (elo <= 800) {
      depth = 1;
      blunderChance = 0.30;
    } else if (elo <= 1200) {
      depth = 2;
      blunderChance = 0.12;
    } else if (elo <= 1600) {
      depth = 3;
      blunderChance = 0.03;
    } else {
      depth = 4;
      blunderChance = 0.0;
    }

    // Blunder: play a random legal move
    if (Math.random() < blunderChance) {
      return legal[Math.floor(Math.random() * legal.length)];
    }

    // Identify opponent's last move from events (for trap paranoia and bait evaluation)
    let lastOppMove = null;
    if (events && events.length > 0) {
      const lastEvent = [...events].reverse().find(e => !e.startsWith('trap:') && e.length >= 4);
      if (lastEvent) {
        lastOppMove = board.parseUci(lastEvent);
      }
    }

    const searchDepth = (legal.length > 25 && depth > 2) ? depth - 1 : depth;

    // Evaluate each candidate move with Minimax + Predichess Lookahead heuristics
    const moveEvaluations = legal.map(move => {
      const nextBoard = board.copy();
      nextBoard.applyChessMove(move);
      const [evalVal] = this.minimax(nextBoard, searchDepth - 1, -Infinity, Infinity, !isMaximizing, elo);
      let relativeScore = isMaximizing ? evalVal : -evalVal;

      // --- OFFENSE: Manifesting King Check-Snipe Opportunities ---
      // If our move checks the opponent King, look at how many escape moves they have
      if (nextBoard.isInCheck(oppColor)) {
        const oppEscapes = nextBoard.legalMoves(oppColor);
        if (oppEscapes.length === 1) {
          // Absolute lethal check-snipe! The bot will predict this single escape and vaporize the King!
          relativeScore += 12000;
        } else if (oppEscapes.length === 2) {
          relativeScore += 3500;
        } else if (oppEscapes.length <= 4) {
          relativeScore += 1200;
        }
      }

      // --- OFFENSE: Manifesting Move Bottlenecks (Entropy Reduction) ---
      // Severely restricted opponent positions are extremely predictable
      const oppLegalCount = nextBoard.legalMoves(oppColor).length;
      if (oppLegalCount <= 3) {
        relativeScore += 2500;
      } else if (oppLegalCount <= 6) {
        relativeScore += 1000;
      }

      // --- OFFENSE: Bait-and-Vaporize Multi-Threat Manifestation ---
      // Moving a piece where exactly 1 enemy piece attacks it, but it threatens 2+ enemy targets
      const attackersOnSquare = nextBoard.getAttackers(move.toRow, move.toCol, oppColor);
      if (attackersOnSquare.length === 1) {
        const movingPiece = nextBoard.squares[move.toRow][move.toCol];
        if (movingPiece && movingPiece.type !== PieceType.KING) {
          let targetsCount = 0;
          let attacksKing = false;
          let attacksQueen = false;
          const pMoves = nextBoard.pseudoFrom(move.toRow, move.toCol, movingPiece);
          for (let k = 0; k < pMoves.length; k++) {
            const tr = pMoves[k].toRow;
            const tc = pMoves[k].toCol;
            const tgt = nextBoard.squares[tr][tc];
            if (tgt && tgt.color === oppColor) {
              targetsCount++;
              if (tgt.type === PieceType.KING) attacksKing = true;
              if (tgt.type === PieceType.QUEEN) attacksQueen = true;
            }
          }
          if (attacksKing && targetsCount >= 2) {
            relativeScore += 2500; // Lethal King fork bait
          } else if (attacksQueen && targetsCount >= 2) {
            relativeScore += 1800; // Queen fork bait
          } else if (targetsCount >= 2) {
            relativeScore += 1200; // Multi-threat bait
          }
        }
      }

      // --- DEFENSE: Lethal King Snipe Avoidance ---
      // Look 1-ply ahead: can opponent counter with a check that bottlenecks our King into <= 1 flight?
      const oppImmediateReplies = nextBoard.legalMoves(oppColor);
      let lethalReplyFound = false;
      for (let i = 0; i < oppImmediateReplies.length; i++) {
        const reply = oppImmediateReplies[i];
        const repBoard = nextBoard.copy();
        repBoard.applyChessMove(reply);
        if (repBoard.isInCheck(color)) {
          const myEscapes = repBoard.legalMoves(color);
          if (myEscapes.length <= 1) {
            lethalReplyFound = true;
            break;
          }
        }
      }
      if (lethalReplyFound) {
        relativeScore -= 10000;
      }

      // --- DEFENSE: Trap Paranoia & Anti-Bait (ELO >= 1400) ---
      // If candidate move captures opponent's newly moved, undefended piece:
      // In Predichess, this is likely a bait trap designed to vaporize our capturing piece!
      if (lastOppMove && move.toRow === lastOppMove.toRow && move.toCol === lastOppMove.toCol) {
        const oppDefenders = board.getAttackers(lastOppMove.toRow, lastOppMove.toCol, oppColor);
        if (oppDefenders.length === 0) {
          const capturingPiece = board.squares[move.fromRow][move.fromCol];
          const pieceVal = capturingPiece ? (PIECE_VALUES[capturingPiece.type] || 300) : 300;
          const paranoiaFactor = elo >= 2000 ? 0.85 : (elo >= 1600 ? 0.65 : 0.40);
          relativeScore -= Math.round(pieceVal * paranoiaFactor);
        }
      }

      return { move, score: relativeScore };
    });

    // Sort by best moves first (descending relative score)
    moveEvaluations.sort((a, b) => b.score - a.score);

    // If the top move is a checkmate or forced king-snipe setup, play it immediately!
    if (moveEvaluations[0].score >= 8000) {
      return moveEvaluations[0].move;
    }

    // At ELO 2000: strictly play the top move (or top 2 with heavy bias)
    if (elo >= 2000) {
      if (moveEvaluations.length === 1 || moveEvaluations[0].score > moveEvaluations[1].score + 50) {
        return moveEvaluations[0].move;
      }
      return Math.random() < 0.85 ? moveEvaluations[0].move : moveEvaluations[1].move;
    }

    // Take top choices (up to top 4 moves)
    const numChoices = Math.min(4, moveEvaluations.length);
    const topChoices = moveEvaluations.slice(0, numChoices);

    // Shift scores relative to the lowest score in the top choices
    const minScore = topChoices[topChoices.length - 1].score;
    const shiftedScores = topChoices.map(c => ({
      move: c.move,
      shifted: Math.max(1, c.score - minScore + 15)
    }));

    // Square scores to heavily weight towards absolute best choices
    const weights = shiftedScores.map(s => ({
      move: s.move,
      weight: s.shifted * s.shifted
    }));
    const totalWeight = weights.reduce((acc, w) => acc + w.weight, 0);

    // Weighted random sampling
    let rand = Math.random() * totalWeight;
    for (const item of weights) {
      rand -= item.weight;
      if (rand <= 0) {
        return item.move;
      }
    }

    return topChoices[0].move;
  },

  getWeightedPrediction(board, playerColor, elo = 1600, events = []) {
    const playerMoves = board.legalMoves(playerColor);
    if (playerMoves.length === 0) return "";
    if (playerMoves.length === 1) return playerMoves[0].toUci();

    // Dynamic blunder chances for prediction sampler
    let blunderChance = 0.0;
    if (elo <= 800) blunderChance = 0.35;
    else if (elo <= 1200) blunderChance = 0.15;
    else if (elo <= 1600) blunderChance = 0.04;

    if (Math.random() < blunderChance) {
      return playerMoves[Math.floor(Math.random() * playerMoves.length)].toUci();
    }

    // --- TIER 1: King-Snipe (Player is in check with forced or narrow escapes) ---
    if (board.isInCheck(playerColor)) {
      // If player has only 1 legal move to escape check: 100% certainty!
      if (playerMoves.length === 1) {
        return playerMoves[0].toUci();
      }
      // If player has 2 legal moves to escape check:
      if (playerMoves.length === 2) {
        const c0 = board.copy();
        c0.applyChessMove(playerMoves[0]);
        const s0 = this.evaluateBoard(c0);
        const c1 = board.copy();
        c1.applyChessMove(playerMoves[1]);
        const s1 = this.evaluateBoard(c1);

        const isPlayerWhite = playerColor === PieceColor.WHITE;
        const rel0 = isPlayerWhite ? s0 : -s0;
        const rel1 = isPlayerWhite ? s1 : -s1;
        const betterMove = rel0 >= rel1 ? playerMoves[0] : playerMoves[1];
        const worseMove = rel0 >= rel1 ? playerMoves[1] : playerMoves[0];

        const roll = Math.random();
        if (elo >= 1400) {
          return roll < 0.75 ? betterMove.toUci() : worseMove.toUci();
        } else {
          return roll < 0.50 ? betterMove.toUci() : worseMove.toUci();
        }
      }
    }

    // --- TIER 2: Sprung Bait Trap (Player capturing the bot's deliberately placed bait piece) ---
    let lastBotMove = null;
    if (events && events.length > 0) {
      const lastEvent = [...events].reverse().find(e => !e.startsWith('trap:') && e.length >= 4);
      if (lastEvent) {
        lastBotMove = board.parseUci(lastEvent);
      }
    }

    if (lastBotMove) {
      const captureBaitMoves = playerMoves.filter(
        m => m.toRow === lastBotMove.toRow && m.toCol === lastBotMove.toCol
      );

      if (captureBaitMoves.length === 1) {
        // Exactly ONE player move captures our bait!
        // The bot placed this bait specifically to vaporize the enemy attacker!
        const baitPredictProb = elo >= 2000 ? 0.80 : (elo >= 1600 ? 0.65 : 0.45);
        if (Math.random() < baitPredictProb) {
          return captureBaitMoves[0].toUci();
        }
      } else if (captureBaitMoves.length > 1) {
        // Multiple player pieces can capture our piece (e.g. recaptures)
        const baitPredictProb = elo >= 2000 ? 0.65 : (elo >= 1600 ? 0.50 : 0.35);
        if (Math.random() < baitPredictProb) {
          // Humans strongly prefer capturing with the lowest-value piece (e.g. pawn first)
          captureBaitMoves.sort((a, b) => {
            const pA = board.squares[a.fromRow][a.fromCol];
            const pB = board.squares[b.fromRow][b.fromCol];
            const vA = pA ? (PIECE_VALUES[pA.type] || 0) : 0;
            const vB = pB ? (PIECE_VALUES[pB.type] || 0) : 0;
            return vA - vB;
          });
          return captureBaitMoves[0].toUci();
        }
      }

      // --- TIER 3: Attacked High-Value Piece Evacuation ---
      const botPiece = board.squares[lastBotMove.toRow][lastBotMove.toCol];
      if (botPiece) {
        const attackedMajorPieces = [];
        const pseudo = board.pseudoFrom(lastBotMove.toRow, lastBotMove.toCol, botPiece);
        for (const m of pseudo) {
          const target = board.squares[m.toRow][m.toCol];
          if (target && target.color === playerColor && 
              (target.type === PieceType.QUEEN || target.type === PieceType.ROOK)) {
            attackedMajorPieces.push({ row: m.toRow, col: m.toCol, piece: target });
          }
        }
        if (attackedMajorPieces.length > 0) {
          attackedMajorPieces.sort((a, b) => (PIECE_VALUES[b.piece.type] || 0) - (PIECE_VALUES[a.piece.type] || 0));
          const targetToSave = attackedMajorPieces[0];
          const escapeMoves = playerMoves.filter(
            m => m.fromRow === targetToSave.row && m.fromCol === targetToSave.col
          );
          if (escapeMoves.length > 0) {
            const fleeProb = elo >= 1600 ? 0.60 : 0.40;
            if (Math.random() < fleeProb) {
              const scoredEscapes = escapeMoves.map(m => {
                const bCopy = board.copy();
                bCopy.applyChessMove(m);
                const score = playerColor === PieceColor.WHITE ? 
                  this.evaluateBoard(bCopy) : -this.evaluateBoard(bCopy);
                return { move: m, score };
              });
              scoredEscapes.sort((a, b) => b.score - a.score);
              return scoredEscapes[0].move.toUci();
            }
          }
        }
      }
    }

    // --- TIER 4: General High-Evaluation Softmax Sampling ---
    const isPlayerWhite = playerColor === PieceColor.WHITE;
    const moveEvaluations = playerMoves.map(move => {
      const nextBoard = board.copy();
      nextBoard.applyChessMove(move);
      const score = this.evaluateBoard(nextBoard);
      const relativeScore = isPlayerWhite ? score : -score;
      return { move, score: relativeScore };
    });

    moveEvaluations.sort((a, b) => b.score - a.score);

    // Dynamic selection breadth based on ELO
    let numChoices;
    if (elo >= 2000) numChoices = Math.min(2, moveEvaluations.length);
    else if (elo >= 1600) numChoices = Math.min(3, moveEvaluations.length);
    else if (elo >= 1200) numChoices = Math.min(4, moveEvaluations.length);
    else numChoices = Math.min(6, moveEvaluations.length);

    const topChoices = moveEvaluations.slice(0, numChoices);
    const minScore = topChoices[topChoices.length - 1].score;

    const shiftedScores = topChoices.map(c => ({
      move: c.move,
      shifted: Math.max(1, c.score - minScore + 10)
    }));

    const power = elo >= 1600 ? 3 : 2;
    const weights = shiftedScores.map(s => ({
      move: s.move,
      weight: Math.pow(s.shifted, power)
    }));
    const totalWeight = weights.reduce((acc, w) => acc + w.weight, 0);

    let rand = Math.random() * totalWeight;
    for (const item of weights) {
      rand -= item.weight;
      if (rand <= 0) {
        return item.move.toUci();
      }
    }

    return topChoices[0].move.toUci();
  }
};
