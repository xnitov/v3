// what are you looking for?

// constants

const PIECE_CDN = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/';

const LEVELS = [
  { name:'Novice',       elo:'~800'  },
  { name:'Beginner',     elo:'~950'  },
  { name:'Beginner',     elo:'~1050' },
  { name:'Casual',       elo:'~1150' },
  { name:'Casual',       elo:'~1250' },
  { name:'Intermediate', elo:'~1400' },
  { name:'Intermediate', elo:'~1550' },
  { name:'Club',         elo:'~1650' },
  { name:'Club',         elo:'~1800' },
  { name:'Advanced',     elo:'~1950' },
  { name:'Advanced',     elo:'~2050' },
  { name:'Expert',       elo:'~2150' },
  { name:'Expert',       elo:'~2250' },
  { name:'Master',       elo:'~2350' },
  { name:'Master',       elo:'~2450' },
  { name:'IM',           elo:'~2550' },
  { name:'IM',           elo:'~2600' },
  { name:'GM',           elo:'~2700' },
  { name:'GM',           elo:'~2800' },
  { name:'Super-GM',     elo:'~2900' },
  { name:'Max Engine',   elo:'3300+' },
];

const MOVETIME = [150,200,250,300,400,500,600,700,800,900,1000,
                  1100,1200,1300,1400,1600,1800,2000,2200,2500,3000];

// state

const S = {
  game:        null,
  cursor:      { row:7, col:4 },
  selected:    null,
  legalMoves:  [],
  playerColor: 'w',
  level:       5,
  lastMove:    null,
  gameOver:    false,
  isThinking:  false,
  moves:       [],
  openingId:   'free',
  inBook:      false,
};

let sf = null, sfReady = false;
let pendingPromo = null;
let promoIndex   = 0;

// coordinate

function d2a(row, col) {
  if (S.playerColor === 'b') return 'abcdefgh'[7-col] + (row+1);
  return 'abcdefgh'[col] + (8-row);
}

function a2d(sq) {
  const col = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1]);
  if (S.playerColor === 'b') return { row: rank-1, col: 7-col };
  return { row: 8-rank, col };
}

function pieceUrl(color, type) {
  return PIECE_CDN + color + type.toUpperCase() + '.svg';
}

function isMyTurn() {
  return S.game && S.game.turn() === S.playerColor && !S.gameOver && !S.isThinking;
}

//  sf

function initSF() {
  if (sf) { try { sf.terminate(); } catch(e){} sf = null; sfReady = false; }
  try {
    const code = "importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js')";
    const burl = URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
    sf = new Worker(burl);
    URL.revokeObjectURL(burl);
    sf.onmessage = onSFMsg;
    sf.onerror   = () => setEngineStatus('Engine unavailable');
    sf.postMessage('uci');
    setEngineStatus('Loading engine...');
  } catch(e) {
    setEngineStatus('Engine failed to load');
    console.error('SF init failed:', e);
  }
}

function onSFMsg(e) {
  const msg = e.data;
  if (msg === 'uciok') {
    sfReady = true;
    sf.postMessage('ucinewgame');
    setSFLevel();
    setEngineStatus('Engine ready');
    setTimeout(() => setEngineStatus(''), 1500);
    if (S.playerColor === 'b') setTimeout(triggerEngine, 400);
  }
  if (msg.startsWith('bestmove')) {
    const mv = msg.split(' ')[1];
    if (mv && mv !== '(none)') applySFMove(mv);
    else { S.isThinking = false; updateStatus(); render(); }
  }
}

function setSFLevel() {
  if (!sfReady) return;
  sf.postMessage('setoption name Skill Level value ' + S.level);
  if (S.level < 20) {
    sf.postMessage('setoption name UCI_LimitStrength value true');
    const elo = Math.round(800 + (S.level/20)*2400);
    sf.postMessage('setoption name UCI_Elo value ' + elo);
  } else {
    sf.postMessage('setoption name UCI_LimitStrength value false');
  }
}

function triggerSF() {
  if (!sfReady || S.gameOver || S.game.turn() === S.playerColor) return;
  S.isThinking = true;
  updateStatus();
  setSFLevel();
  sf.postMessage('position fen ' + S.game.fen());
  sf.postMessage('go movetime ' + MOVETIME[S.level]);
  setEngineStatus('Thinking...');
}

function applySFMove(mv) {
  const from  = mv.slice(0,2);
  const to    = mv.slice(2,4);
  const promo = mv[4] || undefined;
  const mo    = { from, to };
  if (promo) mo.promotion = promo;
  const r = S.game.move(mo);
  if (r) {
    S.lastMove   = { from, to };
    S.moves.push(r.san);
    S.isThinking = false;
    checkGameOver();
    updateMoveHistory();
    render();
    updateStatus();
    setEngineStatus('');
  }
}

//  opening book

function sanBase(san) {
  return san.replace(/[+#!?]/g, '').trim();
}

function getBookMove() {
  if (S.openingId === 'free') return null;
  const opening = OPENINGS.find(o => o.id === S.openingId);
  if (!opening || opening.moves.length === 0) return null;
  const history = S.game.history();
  if (history.length >= opening.moves.length) return null;
  for (let i = 0; i < history.length; i++) {
    if (sanBase(history[i]) !== sanBase(opening.moves[i])) return null;
  }
  return opening.moves[history.length];
}

function applyBookMove(san) {
  const delay = 220 + Math.random() * 380;
  setTimeout(() => {
    const r = S.game.move(san);
    if (r) {
      S.lastMove   = { from: r.from, to: r.to };
      S.moves.push(r.san);
      S.isThinking = false;
      S.inBook     = true;
      checkGameOver();
      updateMoveHistory();
      render();
      updateStatus();
      updateBookBadge();
      setEngineStatus('');
    } else {
      S.isThinking = false;
      S.inBook     = false;
      updateBookBadge();
      triggerSF();
    }
  }, delay);
}

function triggerEngine() {
  if (S.gameOver || S.game.turn() === S.playerColor) return;
  const bookMove = getBookMove();
  if (bookMove) {
    S.isThinking = true;
    S.inBook     = true;
    updateStatus();
    updateBookBadge();
    setEngineStatus('Book...');
    applyBookMove(bookMove);
    return;
  }
  S.inBook = false;
  updateBookBadge();
  triggerSF();
}

function updateBookBadge() {
  const badge = document.getElementById('bookBadge');
  if (!badge) return;
  if (S.openingId === 'free' || !S.inBook) {
    badge.textContent = '';
    badge.className   = 'book-badge';
  } else {
    badge.textContent = 'In Book';
    badge.className   = 'book-badge active';
  }
}

// logic

function newGame() {
  S.game       = new Chess();
  S.selected   = null;
  S.legalMoves = [];
  S.lastMove   = null;
  S.gameOver   = false;
  S.isThinking = false;
  S.inBook     = false;
  S.moves      = [];
  S.cursor     = S.playerColor === 'w' ? { row:7, col:4 } : { row:0, col:4 };
  if (sfReady) { sf.postMessage('ucinewgame'); setSFLevel(); }
  document.getElementById('resultOverlay').classList.add('hidden');
  updateMoveHistory();
  updateBookBadge();
  buildCoords();
  render();
  updateStatus();
  if (S.playerColor === 'b') setTimeout(triggerEngine, 400);
}

function selectPiece(sq) {
  S.selected   = sq;
  S.legalMoves = S.game.moves({ square:sq, verbose:true }).map(m => m.to);
}

function handleSquare(sq) {
  if (!isMyTurn()) return;
  if (S.selected) {
    if (S.legalMoves.includes(sq)) { doMove(S.selected, sq); return; }
    const p = S.game.get(sq);
    if (p && p.color === S.playerColor) { selectPiece(sq); render(); return; }
    S.selected = null; S.legalMoves = []; render();
  } else {
    const p = S.game.get(sq);
    if (p && p.color === S.playerColor) { selectPiece(sq); render(); }
  }
}

function doMove(from, to, promo) {
  if (!promo) {
    const p = S.game.get(from);
    const rank = parseInt(to[1]);
    if (p && p.type === 'p' && ((p.color==='w'&&rank===8)||(p.color==='b'&&rank===1))) {
      pendingPromo = { from, to };
      showPromo(p.color);
      return;
    }
  }
  const mo = { from, to };
  if (promo) mo.promotion = promo;
  const r = S.game.move(mo);
  if (r) {
    S.lastMove   = { from, to };
    S.moves.push(r.san);
    S.selected   = null;
    S.legalMoves = [];
    checkGameOver();
    updateMoveHistory();
    render();
    updateStatus();
    if (!S.gameOver) triggerEngine();
  }
}

function checkGameOver() {
  S.gameOver = S.game.in_checkmate() || S.game.in_stalemate() ||
               S.game.in_draw() || S.game.insufficient_material() ||
               S.game.in_threefold_repetition();
  if (S.gameOver) showResult();
}

//  promotion

function showPromo(color) {
  promoIndex = 0;
  const row = document.getElementById('promoRow');
  row.innerHTML = '';
  ['q','r','b','n'].forEach((type, i) => {
    const btn = document.createElement('button');
    btn.className = 'promo-btn' + (i===0 ? ' promo-focus':'');
    btn.dataset.i = i;
    const img = document.createElement('img');
    img.src = pieceUrl(color, type);
    btn.appendChild(img);
    btn.onclick = () => confirmPromo(type);
    row.appendChild(btn);
  });
  document.getElementById('promoModal').classList.remove('hidden');
}

function updatePromoFocus() {
  document.querySelectorAll('.promo-btn').forEach((b,i) => {
    b.classList.toggle('promo-focus', i===promoIndex);
  });
}

function confirmPromo(type) {
  document.getElementById('promoModal').classList.add('hidden');
  doMove(pendingPromo.from, pendingPromo.to, type);
  pendingPromo = null;
}

//  -------

function render() {
  const el   = document.getElementById('board');
  el.innerHTML = '';
  const bd   = S.game.board();
  const turn = S.game.turn();

  let checkSq = null;
  if (S.game.in_check()) {
    outer: for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
      const p = bd[r][c];
      if (p && p.type==='k' && p.color===turn) {
        checkSq = 'abcdefgh'[c]+(8-r);
        break outer;
      }
    }
  }

  for (let dr=0; dr<8; dr++) {
    for (let dc=0; dc<8; dc++) {
      const sq     = d2a(dr, dc);
      const boardR = S.playerColor==='b' ? 7-dr : dr;
      const boardC = S.playerColor==='b' ? 7-dc : dc;
      const piece  = bd[boardR][boardC];

      const div  = document.createElement('div');
      div.className = 'sq ' + ((boardR+boardC)%2===0 ? 'light':'dark');
      div.dataset.sq = sq;

      if (S.lastMove) {
        if (sq===S.lastMove.from) div.classList.add('lm-f');
        if (sq===S.lastMove.to)   div.classList.add('lm-t');
      }
      if (sq===S.selected)           div.classList.add('selected');
      if (S.legalMoves.includes(sq)) { div.classList.add('legal'); if(piece) div.classList.add('occupied'); }
      if (dr===S.cursor.row && dc===S.cursor.col) div.classList.add('cursor');
      if (sq===checkSq)              div.classList.add('check-sq');

      if (piece) {
        const img = document.createElement('img');
        img.className = 'piece';
        img.src = pieceUrl(piece.color, piece.type);
        img.draggable = false;
        div.appendChild(img);
      }

      div.addEventListener('click', () => {
        S.cursor = { row:dr, col:dc };
        handleSquare(sq);
      });

      el.appendChild(div);
    }
  }
}

//  labels

function buildCoords() {
  const flipped = S.playerColor === 'b';
  const ranks   = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const files   = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];

  const rl = document.getElementById('rankLabels');
  rl.innerHTML = '';
  ranks.forEach(r => { const d=document.createElement('div'); d.className='rl'; d.textContent=r; rl.appendChild(d); });

  const fl = document.getElementById('fileLabels');
  fl.innerHTML = '';
  files.forEach(f => { const d=document.createElement('div'); d.className='fl'; d.textContent=f; fl.appendChild(d); });
}

// ═══════════════════════════════════════════════
//  STATUS & UI
// ═══════════════════════════════════════════════

function updateStatus() {
  const el = document.getElementById('statusText');
  el.className = '';
  if (S.gameOver) { el.className = 'gameover'; el.textContent = 'Game over'; return; }
  if (S.isThinking) {
    el.className = 'thinking';
    el.innerHTML = 'Engine thinking<span class="dots"></span>';
    return;
  }
  if (S.game.in_check()) {
    el.className = 'check';
    el.textContent = (S.game.turn()==='w' ? 'White' : 'Black') + ' is in check!';
    return;
  }
  el.textContent = S.game.turn() === S.playerColor ? 'Your turn' : 'Waiting...';
}

function showResult() {
  const ov    = document.getElementById('resultOverlay');
  const title = document.getElementById('resultTitle');
  const sub   = document.getElementById('resultSub');
  ov.classList.remove('hidden');
  if (S.game.in_checkmate()) {
    const winner = S.game.turn()==='w' ? 'Black' : 'White';
    const youWin = (winner==='White'&&S.playerColor==='w')||(winner==='Black'&&S.playerColor==='b');
    title.textContent = youWin ? 'You Win' : 'You Lose';
    sub.textContent   = winner + ' wins by checkmate';
  } else {
    title.textContent = 'Draw';
    if (S.game.in_stalemate())               sub.textContent = 'by stalemate';
    else if (S.game.insufficient_material()) sub.textContent = 'insufficient material';
    else if (S.game.in_threefold_repetition()) sub.textContent = 'by threefold repetition';
    else sub.textContent = 'by the 50-move rule';
  }
}

function updateMoveHistory() {
  const el = document.getElementById('moveHistory');
  el.innerHTML = '';
  for (let i=0; i<S.moves.length; i+=2) {
    const row = document.createElement('div');
    row.className = 'mv-row';
    const num = document.createElement('span');
    num.className = 'mv-num';
    num.textContent = (i/2+1) + '.';
    const mw = document.createElement('span');
    mw.className = 'mv-w' + (i===S.moves.length-1 ? ' latest':'');
    mw.textContent = S.moves[i];
    row.appendChild(num);
    row.appendChild(mw);
    if (S.moves[i+1] !== undefined) {
      const mb = document.createElement('span');
      mb.className = 'mv-b' + (i+1===S.moves.length-1 ? ' latest':'');
      mb.textContent = S.moves[i+1];
      row.appendChild(mb);
    }
    el.appendChild(row);
  }
  el.scrollTop = el.scrollHeight;
}

function updateLevelDisplay() {
  const lv = LEVELS[S.level];
  document.getElementById('lvName').textContent = lv.name;
  document.getElementById('lvElo').textContent  = lv.elo;
  const sl = document.getElementById('lvSlider');
  sl.style.setProperty('--pct', (S.level/20*100).toFixed(1));
}

function setEngineStatus(msg) {
  const el = document.getElementById('engineStatus');
  el.textContent = msg;
  el.className = msg ? 'active' : '';
}

function buildOpeningSelect() {
  const sel = document.getElementById('openingSelect');
  if (!sel) return;
  const groups = {};
  OPENINGS.forEach(o => {
    if (!groups[o.group]) groups[o.group] = [];
    groups[o.group].push(o);
  });
  sel.innerHTML = '';
  Object.keys(groups).forEach(g => {
    if (g === '—') {
      groups[g].forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id; opt.textContent = o.name;
        sel.appendChild(opt);
      });
    } else {
      const og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id; opt.textContent = o.name;
        og.appendChild(opt);
      });
      sel.appendChild(og);
    }
  });
  sel.value = S.openingId;
}

//  keys

document.addEventListener('keydown', e => {
  const key = e.key;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(key)) e.preventDefault();

  const promoOpen = !document.getElementById('promoModal').classList.contains('hidden');

  if (promoOpen) {
    const PIECES = ['q','r','b','n'];
    if (key === 'ArrowLeft')  { promoIndex = (promoIndex+3)%4; updatePromoFocus(); }
    if (key === 'ArrowRight') { promoIndex = (promoIndex+1)%4; updatePromoFocus(); }
    if (key === ' ' || key === 'Enter') { confirmPromo(PIECES[promoIndex]); }
    if (key === 'Escape') {
      document.getElementById('promoModal').classList.add('hidden');
      pendingPromo = null; S.selected = null; S.legalMoves = []; render();
    }
    return;
  }

  switch(key) {
    case 'ArrowUp':    S.cursor.row = Math.max(0, S.cursor.row-1); render(); break;
    case 'ArrowDown':  S.cursor.row = Math.min(7, S.cursor.row+1); render(); break;
    case 'ArrowLeft':  S.cursor.col = Math.max(0, S.cursor.col-1); render(); break;
    case 'ArrowRight': S.cursor.col = Math.min(7, S.cursor.col+1); render(); break;
    case ' ':          handleSquare(d2a(S.cursor.row, S.cursor.col)); break;
    case 'Escape':     S.selected = null; S.legalMoves = []; render(); break;
  }
});

// ═══════════════════════════════════════════════
//  UI CONTROLS
// ═══════════════════════════════════════════════

document.getElementById('lvSlider').addEventListener('input', function() {
  S.level = parseInt(this.value);
  updateLevelDisplay();
  if (sfReady) setSFLevel();
});

document.getElementById('btnW').addEventListener('click', () => {
  S.playerColor = 'w';
  document.getElementById('btnW').classList.add('active');
  document.getElementById('btnB').classList.remove('active');
  S.cursor = { row:7, col:4 };
  buildCoords(); render();
});

document.getElementById('btnB').addEventListener('click', () => {
  S.playerColor = 'b';
  document.getElementById('btnB').classList.add('active');
  document.getElementById('btnW').classList.remove('active');
  S.cursor = { row:0, col:3 };
  buildCoords(); render();
});

document.getElementById('ngBtn').addEventListener('click', newGame);

document.getElementById('openingSelect').addEventListener('change', function() {
  S.openingId = this.value;
  S.inBook    = false;
  updateBookBadge();
});

document.getElementById('promoModal').addEventListener('click', function(e) {
  if (e.target === this) { this.classList.add('hidden'); pendingPromo = null; }
});

//  arrowsys

const ARR = {
  arrows:    [],
  highlights:[],
  dragFrom:  null,
  dragTo:    null,
};

const SZ = 90;

function sqCenter(sq) {
  const col = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1]);
  let dc, dr;
  if (S.playerColor === 'b') { dc = 7-col; dr = rank-1; }
  else                        { dc = col;   dr = 8-rank; }
  return { x: dc*SZ + SZ/2, y: dr*SZ + SZ/2 };
}

function toggleArrow(from, to) {
  const idx = ARR.arrows.findIndex(a => a.from===from && a.to===to);
  if (idx >= 0) ARR.arrows.splice(idx, 1);
  else           ARR.arrows.push({ from, to });
}

function toggleHighlight(sq) {
  const idx = ARR.highlights.indexOf(sq);
  if (idx >= 0) ARR.highlights.splice(idx, 1);
  else           ARR.highlights.push(sq);
}

function clearAnnotations() {
  ARR.arrows = []; ARR.highlights = [];
  ARR.dragFrom = null; ARR.dragTo = null;
  renderArrows();
}

function renderArrows() {
  const svg = document.getElementById('arrowLayer');
  [...svg.children].forEach(c => { if (c.tagName !== 'defs') svg.removeChild(c); });

  ARR.highlights.forEach(sq => {
    const {x,y} = sqCenter(sq);
    const c = document.createElementNS('http://www.w3.org/2000/svg','rect');
    c.setAttribute('x', x-SZ/2); c.setAttribute('y', y-SZ/2);
    c.setAttribute('width', SZ); c.setAttribute('height', SZ);
    c.setAttribute('fill','rgba(255,170,0,0.38)');
    c.setAttribute('stroke','rgba(255,170,0,0.75)');
    c.setAttribute('stroke-width','3');
    svg.appendChild(c);
  });

  ARR.arrows.forEach(a => drawArrowSVG(svg, a.from, a.to, false));
  if (ARR.dragFrom && ARR.dragTo && ARR.dragFrom !== ARR.dragTo)
    drawArrowSVG(svg, ARR.dragFrom, ARR.dragTo, true);
}

function drawArrowSVG(svg, from, to, preview) {
  const f = sqCenter(from), t = sqCenter(to);
  const dx = t.x-f.x, dy = t.y-f.y;
  const len = Math.hypot(dx,dy);
  if (len < 1) return;
  const ux = dx/len, uy = dy/len;
  const x1 = f.x+ux*SZ*0.26, y1 = f.y+uy*SZ*0.26;
  const x2 = t.x-ux*SZ*0.30, y2 = t.y-uy*SZ*0.30;
  const line = document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1',x1); line.setAttribute('y1',y1);
  line.setAttribute('x2',x2); line.setAttribute('y2',y2);
  line.setAttribute('stroke', preview ? 'rgba(255,170,0,0.45)' : 'rgba(255,170,0,0.9)');
  line.setAttribute('stroke-width', SZ*0.17);
  line.setAttribute('stroke-linecap','round');
  line.setAttribute('marker-end', preview ? 'url(#ah-preview)' : 'url(#ah)');
  svg.appendChild(line);
}

const boardEl = document.getElementById('board');

function sqFromEvent(e) {
  const rect = boardEl.getBoundingClientRect();
  const dc = Math.floor((e.clientX-rect.left)/SZ);
  const dr = Math.floor((e.clientY-rect.top)/SZ);
  if (dc<0||dc>7||dr<0||dr>7) return null;
  return d2a(dr, dc);
}

boardEl.addEventListener('mousedown', e => {
  if (e.button === 0) { clearAnnotations(); return; }
  if (e.button !== 2) return;
  const sq = sqFromEvent(e); if (!sq) return;
  ARR.dragFrom = sq; ARR.dragTo = sq;
  e.preventDefault();
});

boardEl.addEventListener('mousemove', e => {
  if (!ARR.dragFrom) return;
  const sq = sqFromEvent(e); if (!sq || sq===ARR.dragTo) return;
  ARR.dragTo = sq; renderArrows();
});

document.addEventListener('mousemove', e => {
  if (!ARR.dragFrom) return;
  const sq = sqFromEvent(e); if (!sq || sq===ARR.dragTo) return;
  ARR.dragTo = sq; renderArrows();
});

boardEl.addEventListener('mouseup', e => {
  if (e.button!==2 || !ARR.dragFrom) return;
  const sq = sqFromEvent(e) || ARR.dragTo;
  if (sq===ARR.dragFrom) toggleHighlight(sq);
  else if (sq)           toggleArrow(ARR.dragFrom, sq);
  ARR.dragFrom=null; ARR.dragTo=null; renderArrows();
  e.preventDefault();
});

document.addEventListener('mouseup', e => {
  if (e.button!==2 || !ARR.dragFrom) return;
  const sq = sqFromEvent(e) || ARR.dragTo;
  if (sq && sq!==ARR.dragFrom) toggleArrow(ARR.dragFrom, sq);
  ARR.dragFrom=null; ARR.dragTo=null; renderArrows();
});

boardEl.addEventListener('contextmenu', e => e.preventDefault());

// initialize

const _baseRender = render;
render = function() { _baseRender(); renderArrows(); };

const _baseDoMove = doMove;
doMove = function(from, to, promo) { clearAnnotations(); _baseDoMove(from, to, promo); };

buildOpeningSelect();
updateLevelDisplay();
buildCoords();
S.game = new Chess();
render();
updateStatus();
initSF();

console.log("what?");
