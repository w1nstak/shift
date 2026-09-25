/* Shift Sea Battle — Mini App client */
(function (global) {
  'use strict';

  var STAKES = [10, 50, 100, 500, 1000];
  var FLEET = [
    { id: 'carrier', name: 'Carrier', length: 5 },
    { id: 'battleship', name: 'Battleship', length: 4 },
    { id: 'cruiser', name: 'Cruiser', length: 3 },
    { id: 'submarine', name: 'Submarine', length: 3 },
    { id: 'destroyer', name: 'Destroyer', length: 2 },
  ];

  var state = {
    open: false,
    screen: 'lobby', // lobby | stake | confirm | search | vs | place | battle | result | board | profile
    stake: 100,
    mode: 'quick', // quick | private | practice
    room: null,
    coins: 0,
    userId: 0,
    chatId: 0,
    name: 'Игрок',
    photoUrl: '',
    avatarLetter: 'И',
    level: 1,
    profileEco: null,
    missions: null,
    screenExtra: null,
    api: '',
    ws: null,
    placing: null, // { id, horizontal }
    ships: {},
    flash: null,
    countdown: null,
    fx: null,
    boardPeriod: 'all',
    leaderboard: [],
    stats: null,
    inviteCode: '',
    local: false, // offline practice
    animatingShot: false,
  };

  var hooks = {
    haptic: function () {},
    toast: function () {},
    onExit: function () {},
    getTg: function () { return null; },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('ru-RU');
  }

  function apiBase() {
    return (state.api || '').replace(/\/$/, '');
  }

  function headers() {
    var h = { 'Content-Type': 'application/json' };
    var tg = hooks.getTg();
    if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
    h['X-Shift-User'] = String(state.userId || 0);
    h['X-Shift-Chat'] = String(state.chatId || state.userId || 0);
    h['X-Shift-Name'] = state.name || 'Игрок';
    h['X-Shift-Level'] = String(state.level || 1);
    if (state.photoUrl) h['X-Shift-Photo'] = state.photoUrl;
    return h;
  }

  async function api(path, opts) {
    if (hooks.apiFetch) return hooks.apiFetch(path, opts);
    var base = apiBase();
    if (!base) throw new Error('NO_API');
    var res = await fetch(base + path, Object.assign({ headers: headers() }, opts || {}));
    var data = await res.json().catch(function () { return { ok: false, error: 'Bad response' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function connectWs(roomId) {
    var base = apiBase();
    if (!base || !roomId) return;
    try {
      var u = new URL(base);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.pathname = '/ws/sea';
      var tg = hooks.getTg();
      var q = new URLSearchParams();
      q.set('room_id', roomId);
      q.set('user_id', String(state.userId || 0));
      q.set('chat_id', String(state.chatId || state.userId || 0));
      q.set('name', state.name || 'Игрок');
      q.set('level', String(state.level || 1));
      if (state.photoUrl) q.set('photo_url', state.photoUrl);
      if (tg && tg.initData) q.set('initData', tg.initData);
      u.search = q.toString();
      if (state.ws) {
        try { state.ws.close(); } catch (e) {}
      }
      var ws = new WebSocket(u.toString());
      state.ws = ws;
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          onServerEvent(msg);
        } catch (e) {}
      };
      ws.onopen = function () {
        ws.send(JSON.stringify({ type: 'subscribe', room_id: roomId }));
      };
    } catch (e) {}
  }

  function onServerEvent(msg) {
    if (msg.balance != null) state.coins = msg.balance;
    if (msg.room) state.room = msg.room;
    if (msg.type === 'matched') {
      state.screen = 'vs';
      render();
      startCountdown();
      return;
    }
    if (msg.type === 'shot') {
      playShotFx(msg);
      if (msg.finished) {
        setTimeout(function () {
          state.screen = 'result';
          render();
        }, 900);
        return;
      }
      render();
      return;
    }
    if (msg.type === 'state' || msg.type === 'forfeit') {
      if (msg.room && msg.room.status === 'PLAYING' && state.screen === 'place') {
        state.screen = 'battle';
      }
      if (msg.room && msg.room.status === 'FINISHED') {
        state.screen = 'result';
      }
      render();
    }
    if (msg.type === 'error') hooks.toast(msg.error || 'Ошибка');
  }

  function startCountdown() {
    var n = 3;
    state.countdown = n;
    render();
    var t = setInterval(function () {
      n -= 1;
      state.countdown = n > 0 ? n : 'BATTLE';
      render();
      hooks.haptic('medium');
      if (n <= 0) {
        clearInterval(t);
        setTimeout(function () {
          state.countdown = null;
          state.screen = 'place';
          initPlacement();
          render();
        }, 700);
      }
    }, 900);
  }

  /* ========== Local practice (no API) ========== */
  function localBotFleet() {
    // simple deterministic-ish random place
    var ships = {};
    var occ = {};
    FLEET.forEach(function (f) {
      for (var tries = 0; tries < 200; tries++) {
        var hor = Math.random() > 0.5;
        var r = Math.floor(Math.random() * 10);
        var c = Math.floor(Math.random() * 10);
        var cells = cellsFor(r, c, f.length, hor);
        if (!cells) continue;
        if (cells.some(function (cell) { return blocked(occ, cell); })) continue;
        cells.forEach(function (cell) { occ[cell[0] + '_' + cell[1]] = f.id; });
        ships[f.id] = { id: f.id, r: r, c: c, horizontal: hor, cells: cells, hits: {} };
        break;
      }
    });
    return ships;
  }

  function cellsFor(r, c, len, hor) {
    var cells = [];
    for (var i = 0; i < len; i++) {
      var rr = hor ? r : r + i;
      var cc = hor ? c + i : c;
      if (rr < 0 || rr > 9 || cc < 0 || cc > 9) return null;
      cells.push([rr, cc]);
    }
    return cells;
  }

  function blocked(occ, cell) {
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var k = (cell[0] + dr) + '_' + (cell[1] + dc);
        if (occ[k]) return true;
      }
    }
    return false;
  }

  function initPlacement() {
    state.ships = {};
    state.placing = { id: 'carrier', horizontal: true };
  }

  function placementValid(id, r, c, hor) {
    var f = FLEET.find(function (x) { return x.id === id; });
    if (!f) return false;
    var cells = cellsFor(r, c, f.length, hor);
    if (!cells) return false;
    var occ = {};
    Object.keys(state.ships).forEach(function (sid) {
      if (sid === id) return;
      (state.ships[sid].cells || []).forEach(function (cell) {
        occ[cell[0] + '_' + cell[1]] = sid;
      });
    });
    return !cells.some(function (cell) { return blocked(occ, cell); });
  }

  function placeShipAt(r, c) {
    if (!state.placing) return;
    var id = state.placing.id;
    var hor = state.placing.horizontal;
    if (!placementValid(id, r, c, hor)) {
      hooks.haptic('error');
      return;
    }
    var f = FLEET.find(function (x) { return x.id === id; });
    state.ships[id] = {
      id: id,
      r: r,
      c: c,
      horizontal: hor,
      cells: cellsFor(r, c, f.length, hor),
      hits: {},
    };
    hooks.haptic('success');
    var next = FLEET.find(function (x) { return !state.ships[x.id]; });
    state.placing = next ? { id: next.id, horizontal: true } : null;
    render();
  }

  function autoPlace() {
    state.ships = {};
    var bot = localBotFleet();
    state.ships = bot;
    state.placing = null;
    hooks.haptic('medium');
    render();
  }

  async function submitReady() {
    var payload = FLEET.map(function (f) {
      var s = state.ships[f.id];
      return { id: f.id, r: s.r, c: s.c, horizontal: s.horizontal };
    });
    if (Object.keys(state.ships).length < 5) {
      hooks.toast('Размести все корабли');
      return;
    }
    hooks.haptic('medium');
    if (state.local) {
      state.room = state.room || {};
      state.room.status = 'PLAYING';
      state.room.turn = state.userId;
      state.room.enemy = state.room.enemy || { name: 'Shift AI', level: state.level, is_bot: true };
      state.room._botShips = localBotFleet();
      state.room._myShots = {};
      state.room._botShots = {};
      state.room.you = { shots: 0, hits: 0 };
      state.screen = 'battle';
      render();
      return;
    }
    try {
      var data = await api('/api/sea/place', {
        method: 'POST',
        body: JSON.stringify({ room_id: state.room.room_id, ships: payload }),
      });
      state.room = data.room;
      if (state.room.status === 'PLAYING') state.screen = 'battle';
      else hooks.toast('Ждём соперника…');
      connectWs(state.room.room_id);
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function fire(r, c) {
    if (state.animatingShot) return;
    if (!state.room || state.room.status === 'FINISHED') return;
    var myTurn = state.local
      ? state.room.turn === state.userId
      : state.room.turn === state.userId;
    if (!myTurn) {
      hooks.toast('Ход соперника');
      return;
    }
    hooks.haptic('light');
    state.animatingShot = true;
    state.fx = { kind: 'lock', r: r, c: c };
    render();
    await wait(280);
    state.fx = { kind: 'missile', r: r, c: c };
    render();
    await wait(320);

    if (state.local) {
      localShoot(r, c);
      return;
    }
    try {
      var data = await api('/api/sea/shoot', {
        method: 'POST',
        body: JSON.stringify({ room_id: state.room.room_id, r: r, c: c }),
      });
      if (data.balance != null) animateCoins(state.coins, data.balance);
      onServerEvent(data);
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    } finally {
      state.animatingShot = false;
      state.fx = null;
      render();
    }
  }

  function localShoot(r, c) {
    var key = r + '_' + c;
    if (state.room._myShots[key]) {
      state.animatingShot = false;
      state.fx = null;
      return;
    }
    var hitShip = null;
    Object.keys(state.room._botShips).forEach(function (sid) {
      var s = state.room._botShips[sid];
      s.cells.forEach(function (cell) {
        if (cell[0] === r && cell[1] === c) hitShip = s;
      });
    });
    state.room.you.shots += 1;
    var result = 'miss';
    var sunkCells = null;
    if (hitShip) {
      hitShip.hits = hitShip.hits || {};
      hitShip.hits[key] = true;
      state.room.you.hits += 1;
      var hitCount = Object.keys(hitShip.hits).length;
      if (hitCount >= hitShip.cells.length) {
        result = 'sunk';
        sunkCells = hitShip.cells;
      } else result = 'hit';
      state.room._myShots[key] = { hit: true, sunk: result === 'sunk' };
    } else {
      state.room._myShots[key] = { miss: true };
    }

    playShotFx({ result: result, r: r, c: c, cells: sunkCells && sunkCells.map(function (c) { return { r: c[0], c: c[1] }; }) });
    state.room.enemy = state.room.enemy || {};
    state.room.enemy.board = enemyBoardFromLocal();

    var allSunk = FLEET.every(function (f) {
      var s = state.room._botShips[f.id];
      return s && Object.keys(s.hits || {}).length >= s.cells.length;
    });
    if (allSunk) {
      finishLocal(true);
      return;
    }
    if (result === 'miss') {
      state.room.turn = -1;
      setTimeout(localBotShoot, 700);
    }
    state.animatingShot = false;
    state.fx = null;
    render();
  }

  function enemyBoardFromLocal() {
    var cells = {};
    Object.keys(state.room._myShots).forEach(function (k) {
      cells[k] = state.room._myShots[k];
    });
    var sunk = [];
    Object.keys(state.room._botShips).forEach(function (sid) {
      var s = state.room._botShips[sid];
      if (Object.keys(s.hits || {}).length >= s.cells.length) {
        sunk.push({ id: sid, name: sid, cells: s.cells.map(function (c) { return { r: c[0], c: c[1] }; }) });
      }
    });
    return { cells: cells, sunk: sunk, ships_left: 5 - sunk.length };
  }

  function localBotShoot() {
    var tried = state.room._botShots;
    var r, c, key;
    do {
      r = Math.floor(Math.random() * 10);
      c = Math.floor(Math.random() * 10);
      key = r + '_' + c;
    } while (tried[key]);

    var hit = false;
    Object.keys(state.ships).forEach(function (sid) {
      state.ships[sid].cells.forEach(function (cell) {
        if (cell[0] === r && cell[1] === c) {
          hit = true;
          state.ships[sid].hits = state.ships[sid].hits || {};
          state.ships[sid].hits[key] = true;
        }
      });
    });
    tried[key] = hit ? { hit: true } : { miss: true };
    playShotFx({ result: hit ? 'hit' : 'miss', r: r, c: c, onSelf: true });

    var lost = FLEET.every(function (f) {
      var s = state.ships[f.id];
      return s && Object.keys(s.hits || {}).length >= s.cells.length;
    });
    if (lost) {
      finishLocal(false);
      return;
    }
    if (hit) {
      setTimeout(localBotShoot, 550);
    } else {
      state.room.turn = state.userId;
      render();
    }
  }

  function finishLocal(won) {
    state.room.status = 'FINISHED';
    state.room.winner_id = won ? state.userId : -1;
    state.room.result = {
      won: won,
      delta: won ? state.stake : -state.stake,
      stake: state.stake,
      pot: state.stake * 2,
    };
    // local practice: coins are display-only unless API
    if (won) state.coins += state.stake;
    else state.coins = Math.max(0, state.coins - state.stake);
    state.animatingShot = false;
    state.fx = null;
    state.screen = 'result';
    hooks.haptic(won ? 'success' : 'error');
    render();
  }

  function playShotFx(msg) {
    state.fx = { kind: msg.result, r: msg.r, c: msg.c, onSelf: msg.onSelf };
    hooks.haptic(msg.result === 'miss' ? 'light' : 'heavy');
    render();
    setTimeout(function () {
      if (state.fx && state.fx.kind === msg.result) {
        state.fx = null;
        render();
      }
    }, 700);
  }

  function animateCoins(from, to) {
    state.coins = to;
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ========== Screens ========== */
  function coinPill() {
    return '<div class="sb-coins"><span class="sb-coins__ico">S</span><strong id="sb-coin-val">' + fmt(state.coins) + '</strong><small>S</small></div>';
  }

  function renderLobby() {
    var league = (state.profileEco && state.profileEco.league) || 'Bronze';
    var rating = (state.profileEco && state.profileEco.rating) || 1000;
    var streak = (state.profileEco && state.profileEco.streak) || 0;
    return (
      '<div class="sb-screen sb-lobby">' +
        '<div class="sb-top">' +
          '<button type="button" class="sb-back" data-sb-exit>' + backSvg() + '</button>' +
          '<div class="sb-brand"><small>SHIFT</small><strong>Sea Battle</strong></div>' +
          coinPill() +
        '</div>' +
        '<div class="sb-hero-water" aria-hidden="true"><div class="sb-wave"></div><div class="sb-particles"></div></div>' +
        '<h1 class="sb-title">⚓ Shift Sea Battle</h1>' +
        '<p class="sb-sub">' + esc(league) + ' · ' + rating + ' MMR' + (streak > 1 ? ' · 🔥 ' + streak : '') + '</p>' +
        '<div class="sb-modes">' +
          '<button type="button" class="sb-mode glass" data-sb-mode="quick">' +
            '<strong>QUICK BATTLE</strong><span>Найти соперника по ставке</span></button>' +
          '<button type="button" class="sb-mode glass" data-sb-mode="private">' +
            '<strong>PRIVATE GAME</strong><span>Invite link · Telegram</span></button>' +
          '<button type="button" class="sb-mode glass" data-sb-mode="practice">' +
            '<strong>vs Shift AI</strong><span>Тренировка с ботом</span></button>' +
        '</div>' +
        '<div class="sb-hub">' +
          '<button type="button" class="sb-hub-btn" data-sb-go="board">🏆 Rank</button>' +
          '<button type="button" class="sb-hub-btn" data-sb-missions>🎯 Missions</button>' +
          '<button type="button" class="sb-hub-btn" data-sb-season>📅 Season</button>' +
          '<button type="button" class="sb-hub-btn" data-sb-fleets>⚓ Fleets</button>' +
          '<button type="button" class="sb-hub-btn" data-sb-daily>🎁 Daily</button>' +
          '<button type="button" class="sb-hub-btn" data-sb-wallet>S History</button>' +
        '</div>' +
        '<div class="sb-secondary">' +
          '<button type="button" class="sb-link" data-sb-go="profile">Fleet Profile</button>' +
        '</div>' +
        (apiBase() ? '' : '<p class="sb-warn">API не подключён — локальная тренировка. Задай GAME_API_URL.</p>') +
      '</div>'
    );
  }

  function renderStake() {
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="lobby">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>Ставка</strong></div>' + coinPill() + '</div>' +
        '<p class="sb-label">Выбери ставку S-Coins</p>' +
        '<div class="sb-stakes">' +
          STAKES.map(function (s) {
            return '<button type="button" class="sb-stake' + (state.stake === s ? ' is-on' : '') + '" data-sb-stake="' + s + '">' +
              '<strong>' + s + '</strong><span>S</span></button>';
          }).join('') +
        '</div>' +
        (state.mode === 'private' && state.screen === 'stake' ? (
          '<div class="sb-join-row glass">' +
            '<input id="sb-invite" class="sb-input" placeholder="Код приглашения" value="' + esc(state.inviteCode) + '" />' +
            '<button type="button" class="btn btn--primary" data-sb-join>Войти</button>' +
          '</div>'
        ) : '') +
        '<button type="button" class="btn btn--primary btn--wide sb-cta" data-sb-go="confirm">Продолжить</button>' +
      '</div>'
    );
  }

  function renderConfirm() {
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="stake">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>Готово к бою</strong></div>' + coinPill() + '</div>' +
        '<div class="sb-confirm glass">' +
          '<div class="sb-confirm__row"><span>ENTRY FEE</span><strong>' + state.stake + ' S</strong></div>' +
          '<div class="sb-confirm__row"><span>POT</span><strong class="sb-gold">' + (state.stake * 2) + ' S</strong></div>' +
          '<p>Победитель получает банк. Ставка списывается при старте матча.</p>' +
        '</div>' +
        '<button type="button" class="btn btn--primary btn--wide sb-cta" data-sb-start>START BATTLE</button>' +
      '</div>'
    );
  }

  function renderSearch() {
    return (
      '<div class="sb-screen sb-search">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-cancel-search>' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>Matchmaking</strong></div>' + coinPill() + '</div>' +
        '<div class="sb-radar" aria-hidden="true"><i></i><b></b><em></em></div>' +
        '<h2 class="sb-search-title">⚓ SEARCHING FOR OPPONENT</h2>' +
        '<p class="sb-sub">Ищем соперника…</p>' +
        '<div class="sb-pill">STAKE · ' + state.stake + ' S-Coins</div>' +
        '<button type="button" class="btn btn--ghost btn--wide" style="margin-top:24px" data-sb-force-bot">Играть с Shift AI</button>' +
      '</div>'
    );
  }

  function playerAv(p, cls) {
    var letter = esc((p && (p.avatar || (p.name || '?')[0])) || '?');
    var photo = p && (p.photo_url || p.photoUrl);
    var c = cls || 'sb-av';
    if (photo) {
      return '<div class="' + c + ' ' + c + '--photo"><img src="' + esc(photo) + '" alt="" referrerpolicy="no-referrer" /><span>' + letter + '</span></div>';
    }
    return '<div class="' + c + '">' + letter + '</div>';
  }

  function renderVs() {
    var players = (state.room && state.room.players) || [];
    var a = players[0] || { name: state.name, level: state.level, avatar: state.avatarLetter, photo_url: state.photoUrl };
    var b = players[1] || { name: '…', level: '—', avatar: '?' };
    return (
      '<div class="sb-screen sb-vs">' +
        '<p class="sb-found">Opponent found!</p>' +
        '<div class="sb-vs-row">' +
          '<div class="sb-fighter">' + playerAv(a) + '<strong>' + esc(a.name) + '</strong><span>Lvl ' + esc(a.level) + '</span></div>' +
          '<div class="sb-vs-badge">VS</div>' +
          '<div class="sb-fighter">' + playerAv(b) + '<strong>' + esc(b.name) + '</strong><span>Lvl ' + esc(b.level) + '</span></div>' +
        '</div>' +
        (state.countdown != null ? '<div class="sb-count">' + esc(state.countdown) + '</div>' : '') +
      '</div>'
    );
  }

  function renderPlace() {
    var fleet = FLEET.map(function (f) {
      var on = state.ships[f.id];
      var sel = state.placing && state.placing.id === f.id;
      return '<button type="button" class="sb-shipchip' + (on ? ' is-set' : '') + (sel ? ' is-sel' : '') + '" data-sb-pick="' + f.id + '">' +
        '<strong>' + esc(f.name) + '</strong><span>' + f.length + '</span></button>';
    }).join('');
    return (
      '<div class="sb-screen sb-place">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-exit>' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>YOUR FLEET</strong></div>' + coinPill() + '</div>' +
        '<p class="sb-sub">Расставь корабли · тап по клетке</p>' +
        '<div class="sb-shipchips">' + fleet + '</div>' +
        '<div class="sb-place-actions">' +
          '<button type="button" class="sb-mini" data-sb-rotate>↻ Rotate</button>' +
          '<button type="button" class="sb-mini" data-sb-auto>Auto</button>' +
        '</div>' +
        boardHtml('place', state.ships, null, true) +
        '<button type="button" class="btn btn--primary btn--wide sb-cta" data-sb-ready' +
          (Object.keys(state.ships).length < 5 ? ' disabled' : '') + '>READY</button>' +
      '</div>'
    );
  }

  function boardHtml(kind, myShips, enemyBoard, interactiveOwn) {
    var cells = '';
    var enemyCells = (enemyBoard && enemyBoard.cells) || {};
    for (var r = 0; r < 10; r++) {
      for (var c = 0; c < 10; c++) {
        var key = r + '_' + c;
        var cls = 'sb-cell';
        var content = '';
        if (kind === 'place' || kind === 'own') {
          Object.keys(myShips || {}).forEach(function (sid) {
            var s = myShips[sid];
            (s.cells || []).forEach(function (cell) {
              if (cell[0] === r && cell[1] === c) {
                cls += ' is-ship';
                if (s.hits && s.hits[key]) cls += ' is-hit';
              }
            });
          });
          // bot shots on self in local
          if (state.room && state.room._botShots && state.room._botShots[key]) {
            if (state.room._botShots[key].miss) cls += ' is-miss';
            if (state.room._botShots[key].hit) cls += ' is-hit';
          }
          if (state.room && state.room.you && state.room.you.board && state.room.you.board.cells && state.room.you.board.cells[key]) {
            var oc = state.room.you.board.cells[key];
            if (oc.miss) cls += ' is-miss';
            if (oc.hit) cls += ' is-hit';
          }
        }
        if (kind === 'enemy') {
          var ec = enemyCells[key];
          if (ec) {
            if (ec.miss) cls += ' is-miss';
            if (ec.hit) cls += ' is-hit';
            if (ec.sunk) cls += ' is-sunk';
          }
          if (enemyBoard && enemyBoard.sunk) {
            enemyBoard.sunk.forEach(function (sh) {
              (sh.cells || []).forEach(function (cell) {
                if (cell.r === r && cell.c === c) cls += ' is-sunk';
              });
            });
          }
        }
        if (state.fx && state.fx.r === r && state.fx.c === c) {
          cls += ' is-fx-' + state.fx.kind;
        }
        var attrs = ' class="' + cls + '" data-r="' + r + '" data-c="' + c + '"';
        if (kind === 'place' && interactiveOwn) attrs += ' data-sb-place-cell';
        if (kind === 'enemy') attrs += ' data-sb-fire';
        cells += '<button type="button"' + attrs + '>' + content + '</button>';
      }
    }
    return '<div class="sb-grid sb-grid--' + kind + '" style="--n:10">' + cells + '</div>';
  }

  function renderBattle() {
    var myTurn = state.room && state.room.turn === state.userId;
    var enemy = (state.room && state.room.enemy) || {};
    var enemyBoard = enemy.board || (state.local ? enemyBoardFromLocal() : { cells: {} });
    var ownShips = state.ships;
    if (!state.local && state.room && state.room.you && state.room.you.board && state.room.you.board.ships) {
      ownShips = {};
      state.room.you.board.ships.forEach(function (s) {
        ownShips[s.id] = {
          id: s.id,
          cells: (s.cells || []).map(function (c) { return [c.r, c.c]; }),
          hits: {},
        };
        (s.cells || []).forEach(function (c) {
          var k = c.r + '_' + c.c;
          var cell = state.room.you.board.cells && state.room.you.board.cells[k];
          if (cell && cell.hit) ownShips[s.id].hits[k] = true;
        });
      });
    }
    var turn = myTurn
      ? '<div class="sb-turn is-you"><i></i> YOUR TURN</div>'
      : '<div class="sb-turn is-them"><i></i> OPPONENT\'S TURN<span>Opponent is choosing…</span></div>';

    return (
      '<div class="sb-screen sb-battle">' +
        '<div class="sb-top">' +
          '<button type="button" class="sb-back" data-sb-exit>' + backSvg() + '</button>' +
          '<div class="sb-brand"><small>POT ' + ((state.room && state.room.pot) || state.stake * 2) + ' S</small><strong>Sea Battle</strong></div>' +
          coinPill() +
        '</div>' +
        turn +
        '<p class="sb-zone-label">OPPONENT · ' + esc(enemy.name || 'Соперник') + '</p>' +
        boardHtml('enemy', null, enemyBoard, false) +
        '<p class="sb-zone-label">YOUR FLEET</p>' +
        boardHtml('own', ownShips, null, false) +
        (state.fx ? '<div class="sb-banner-fx">' + fxLabel(state.fx.kind) + '</div>' : '') +
      '</div>'
    );
  }

  function fxLabel(kind) {
    if (kind === 'lock') return '🎯 Target locked';
    if (kind === 'missile') return '🚀';
    if (kind === 'miss') return '💦 MISS';
    if (kind === 'hit') return '🔥 HIT';
    if (kind === 'sunk') return '💥 SHIP DESTROYED';
    return '';
  }

  function renderResult() {
    var won = state.room && state.room.result ? state.room.result.won : (state.room && state.room.winner_id === state.userId);
    var delta = state.room && state.room.result ? state.room.result.delta : (won ? state.stake : -state.stake);
    var you = (state.room && state.room.you) || { shots: 0, hits: 0 };
    var shots = you.shots || 0;
    var hits = you.hits || 0;
    var acc = shots ? Math.round(hits / shots * 100) : 0;
    if (won) {
      return (
        '<div class="sb-screen sb-result sb-result--win">' +
          '<div class="sb-confetti" aria-hidden="true"></div>' +
          '<div class="sb-result-ico">🏆</div>' +
          '<h1>VICTORY</h1>' +
          '<p class="sb-sub">Fleet Commander</p>' +
          '<div class="sb-delta is-plus">+' + Math.abs(delta) + ' S-Coins</div>' +
          '<p class="sb-balance">Баланс: <strong>' + fmt(state.coins) + ' S</strong></p>' +
          statsBlock(shots, hits, acc) +
          '<button type="button" class="btn btn--primary btn--wide" data-sb-again>PLAY AGAIN</button>' +
          '<button type="button" class="btn btn--ghost btn--wide" data-sb-exit>BACK TO GAMES</button>' +
          '<button type="button" class="sb-link" data-sb-challenge>CHALLENGE FRIEND</button>' +
        '</div>'
      );
    }
    return (
      '<div class="sb-screen sb-result">' +
        '<div class="sb-result-ico">⚓</div>' +
        '<h1>BATTLE OVER</h1>' +
        '<p class="sb-sub">Your fleet has been defeated.</p>' +
        '<div class="sb-delta is-minus">' + delta + ' S-Coins</div>' +
        '<p class="sb-balance">Баланс: <strong>' + fmt(state.coins) + ' S</strong></p>' +
        statsBlock(shots, hits, acc) +
        '<button type="button" class="btn btn--primary btn--wide" data-sb-again>REMATCH</button>' +
        '<button type="button" class="btn btn--ghost btn--wide" data-sb-exit>BACK TO GAMES</button>' +
      '</div>'
    );
  }

  function statsBlock(shots, hits, acc) {
    return (
      '<div class="sb-stats glass">' +
        '<div><strong>' + shots + '</strong><small>Shots</small></div>' +
        '<div><strong>' + hits + '</strong><small>Hits</small></div>' +
        '<div><strong>' + acc + '%</strong><small>Accuracy</small></div>' +
      '</div>'
    );
  }

  function renderBoard() {
    var rows = (state.leaderboard || []).map(function (r) {
      return '<div class="sb-lb-row">' +
        '<span class="sb-lb-rank">' + r.rank + '</span>' +
        '<span class="sb-lb-av">' + esc((r.name || '?')[0]) + '</span>' +
        '<span class="sb-lb-body"><strong>' + esc(r.name) + '</strong><small>' + r.wins + 'W · ' + r.win_rate + '%</small></span>' +
        '<span class="sb-lb-meta">' + fmt(r.coins_won) + ' S</span></div>';
    }).join('') || '<p class="sb-sub">Пока пусто — сыграй первый бой.</p>';
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="lobby">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>Leaderboard</strong></div>' + coinPill() + '</div>' +
        '<div class="sb-tabs">' +
          ['today', 'week', 'all'].map(function (p) {
            var label = p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : 'Всё время';
            return '<button type="button" class="' + (state.boardPeriod === p ? 'is-on' : '') + '" data-sb-period="' + p + '">' + label + '</button>';
          }).join('') +
        '</div>' +
        '<div class="sb-lb glass">' + rows + '</div>' +
      '</div>'
    );
  }

  function renderProfile() {
    var s = state.stats || { wins: 0, losses: 0, best_streak: 0, shots: 0, hits: 0 };
    var total = (s.wins || 0) + (s.losses || 0);
    var wr = total ? Math.round(s.wins / total * 100) : 0;
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="lobby">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>Fleet Profile</strong></div>' + coinPill() + '</div>' +
        '<div class="sb-profile glass">' +
          playerAv({ name: state.name, avatar: state.avatarLetter, photo_url: state.photoUrl }, 'sb-av xl') +
          '<h2>' + esc(state.name) + '</h2>' +
          '<span>Level ' + state.level + '</span>' +
          '<div class="sb-stats" style="margin-top:14px">' +
            '<div><strong>' + (s.wins || 0) + '</strong><small>Wins</small></div>' +
            '<div><strong>' + (s.losses || 0) + '</strong><small>Losses</small></div>' +
            '<div><strong>' + wr + '%</strong><small>Win Rate</small></div>' +
            '<div><strong>' + (s.best_streak || 0) + '</strong><small>Best Streak</small></div>' +
          '</div>' +
        '</div>' +
        '<p class="sb-label">Achievements</p>' +
        '<div class="sb-achs">' +
          '<div class="sb-ach' + (s.wins > 0 ? ' is-on' : '') + '">⚓ First Victory</div>' +
          '<div class="sb-ach' + ((s.best_streak || 0) >= 5 ? ' is-on' : '') + '">🔥 5 Win Streak</div>' +
          '<div class="sb-ach">🎯 80% Accuracy</div>' +
          '<div class="sb-ach' + ((s.wins || 0) >= 10 ? ' is-on' : '') + '">👑 Fleet Commander</div>' +
        '</div>' +
      '</div>'
    );
  }

  function backSvg() {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="m14 6-6 6 6 6"/></svg>';
  }

  function render() {
    var host = document.getElementById('seabattle-host');
    if (!host || !state.open) return;
    var html = '';
    if (state.screen === 'lobby') html = renderLobby();
    else if (state.screen === 'stake') html = renderStake();
    else if (state.screen === 'confirm') html = renderConfirm();
    else if (state.screen === 'search') html = renderSearch();
    else if (state.screen === 'vs') html = renderVs();
    else if (state.screen === 'place') html = renderPlace();
    else if (state.screen === 'battle') html = renderBattle();
    else if (state.screen === 'result') html = renderResult();
    else if (state.screen === 'board') html = renderBoard();
    else if (state.screen === 'profile') html = renderProfile();
    else if (state.screen === 'missions') html = renderMissions();
    else if (state.screen === 'season') html = renderSeason();
    else if (state.screen === 'wallet') html = renderWallet();
    else html = renderLobby();
    host.innerHTML = html;
    bind();
  }

  function renderMissions() {
    var items = (state.missions && state.missions.missions) || [];
    var rows = items.map(function (m) {
      var pct = Math.min(100, Math.round((m.current / m.target) * 100));
      return '<div class="sb-mission glass"><strong>' + esc(m.title) + '</strong>' +
        '<div class="sb-mbar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="sb-mission__row"><small>' + m.current + '/' + m.target + ' · +' + m.reward_coins + ' S</small>' +
        (m.done && !m.claimed ? '<button type="button" data-sb-claim="' + m.id + '">CLAIM</button>' : (m.claimed ? '<span class="sb-done">✓</span>' : '')) +
        '</div></div>';
    }).join('') || '<p class="sb-sub">Нет миссий</p>';
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="lobby">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>Daily Missions</strong></div>' + coinPill() + '</div>' +
        rows +
      '</div>'
    );
  }

  function renderSeason() {
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="lobby">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>SHIFT SEASON 01</strong></div>' + coinPill() + '</div>' +
        '<div class="sb-confirm glass">' +
          '<div class="sb-confirm__row"><span>LEVEL</span><strong>' + ((state.profileEco && state.profileEco.season_level) || 1) + '</strong></div>' +
          '<div class="sb-confirm__row"><span>XP</span><strong>' + ((state.profileEco && state.profileEco.season_xp) || 0) + ' / 100</strong></div>' +
          '<p>Battle Pass rewards: S-Coins, skins, frames, badges.</p>' +
        '</div>' +
      '</div>'
    );
  }

  function renderWallet() {
    var rows = (state.wallet || []).map(function (t) {
      var sign = t.amount > 0 ? '+' : '';
      return '<div class="sb-lb-row"><span class="sb-lb-body"><strong>' + esc(t.kind) + '</strong><small>' + new Date((t.created_at || 0) * 1000).toLocaleString('ru-RU') + '</small></span>' +
        '<span class="sb-lb-meta">' + sign + t.amount + ' S</span></div>';
    }).join('') || '<p class="sb-sub">Пока нет транзакций</p>';
    return (
      '<div class="sb-screen">' +
        '<div class="sb-top"><button type="button" class="sb-back" data-sb-go="lobby">' + backSvg() + '</button>' +
          '<div class="sb-brand"><strong>S-Coins</strong></div>' + coinPill() + '</div>' +
        '<div class="sb-lb glass">' + rows + '</div>' +
      '</div>'
    );
  }

  // Event binding
  function bind() {
    var host = document.getElementById('seabattle-host');
    if (!host) return;

    host.querySelectorAll('[data-sb-exit]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    host.querySelectorAll('[data-sb-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        hooks.haptic('selection');
        var go = el.dataset.sbGo;
        if (go === 'board') loadLeaderboard();
        if (go === 'profile') loadProfile();
        if (go === 'confirm' && state.coins < state.stake && apiBase()) {
          hooks.toast('Недостаточно S-Coins');
          return;
        }
        state.screen = go;
        render();
      });
    });
    host.querySelectorAll('[data-sb-mode]').forEach(function (el) {
      el.addEventListener('click', function () {
        hooks.haptic('selection');
        state.mode = el.dataset.sbMode;
        state.screen = 'stake';
        render();
      });
    });
    host.querySelectorAll('[data-sb-stake]').forEach(function (el) {
      el.addEventListener('click', function () {
        hooks.haptic('selection');
        state.stake = Number(el.dataset.sbStake);
        render();
      });
    });
    var start = host.querySelector('[data-sb-start]');
    if (start) start.addEventListener('click', beginMatch);
    var join = host.querySelector('[data-sb-join]');
    if (join) join.addEventListener('click', joinPrivate);
    var inv = host.querySelector('#sb-invite');
    if (inv) inv.addEventListener('input', function () { state.inviteCode = inv.value.trim(); });

    var cancel = host.querySelector('[data-sb-cancel-search]');
    if (cancel) cancel.addEventListener('click', async function () {
      try { if (apiBase()) await api('/api/sea/cancel', { method: 'POST', body: '{}' }); } catch (e) {}
      state.screen = 'lobby';
      render();
    });
    var forceBot = host.querySelector('[data-sb-force-bot]');
    if (forceBot) forceBot.addEventListener('click', startPractice);

    host.querySelectorAll('[data-sb-pick]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.placing = { id: el.dataset.sbPick, horizontal: (state.placing && state.placing.horizontal) !== false };
        render();
      });
    });
    var rot = host.querySelector('[data-sb-rotate]');
    if (rot) rot.addEventListener('click', function () {
      if (!state.placing) return;
      state.placing.horizontal = !state.placing.horizontal;
      hooks.haptic('selection');
      render();
    });
    var auto = host.querySelector('[data-sb-auto]');
    if (auto) auto.addEventListener('click', autoPlace);
    var ready = host.querySelector('[data-sb-ready]');
    if (ready) ready.addEventListener('click', submitReady);

    host.querySelectorAll('[data-sb-place-cell]').forEach(function (el) {
      el.addEventListener('click', function () {
        placeShipAt(Number(el.dataset.r), Number(el.dataset.c));
      });
    });
    host.querySelectorAll('[data-sb-fire]').forEach(function (el) {
      el.addEventListener('click', function () {
        fire(Number(el.dataset.r), Number(el.dataset.c));
      });
    });

    var again = host.querySelector('[data-sb-again]');
    if (again) again.addEventListener('click', function () {
      state.screen = 'stake';
      state.room = null;
      render();
    });
    var challenge = host.querySelector('[data-sb-challenge]');
    if (challenge) challenge.addEventListener('click', shareChallenge);

    host.querySelectorAll('[data-sb-period]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.boardPeriod = el.dataset.sbPeriod;
        loadLeaderboard();
      });
    });

    var missionsBtn = host.querySelector('[data-sb-missions]');
    if (missionsBtn) missionsBtn.addEventListener('click', loadMissions);
    var seasonBtn = host.querySelector('[data-sb-season]');
    if (seasonBtn) seasonBtn.addEventListener('click', function () { state.screen = 'season'; render(); });
    var fleetsBtn = host.querySelector('[data-sb-fleets]');
    if (fleetsBtn) fleetsBtn.addEventListener('click', function () {
      close();
      if (hooks.onOpenFleets) hooks.onOpenFleets();
    });
    var dailyBtn = host.querySelector('[data-sb-daily]');
    if (dailyBtn) dailyBtn.addEventListener('click', claimDaily);
    var walletBtn = host.querySelector('[data-sb-wallet]');
    if (walletBtn) walletBtn.addEventListener('click', loadWallet);
    host.querySelectorAll('[data-sb-claim]').forEach(function (el) {
      el.addEventListener('click', function () { claimMission(el.dataset.sbClaim); });
    });
  }

  async function loadMissions() {
    try {
      if (hooks.apiFetch) state.missions = await hooks.apiFetch('/api/missions');
      else state.missions = await api('/api/missions');
      state.screen = 'missions';
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function claimMission(id) {
    try {
      var fn = hooks.apiFetch || api;
      var res = await fn('/api/missions/claim', { method: 'POST', body: JSON.stringify({ id: id }) });
      if (res.balance != null) state.coins = res.balance;
      hooks.toast('+' + res.reward_coins + ' S');
      loadMissions();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function claimDaily() {
    try {
      var fn = hooks.apiFetch || api;
      var res = await fn('/api/daily', { method: 'POST', body: '{}' });
      state.coins = res.balance;
      hooks.toast('Daily +' + res.reward + ' S');
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function loadWallet() {
    try {
      var fn = hooks.apiFetch || api;
      var data = await fn('/api/wallet');
      state.wallet = data.transactions || [];
      state.screen = 'wallet';
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function beginMatch() {
    hooks.haptic('medium');
    if (state.mode === 'practice' || !apiBase()) {
      return startPractice();
    }
    if (state.mode === 'private') {
      try {
        var data = await api('/api/sea/private', {
          method: 'POST',
          body: JSON.stringify({ stake: state.stake }),
        });
        state.room = data.room;
        state.coins = Math.max(0, state.coins); // escrow on match
        state.screen = 'search';
        render();
        hooks.toast('Код: ' + data.room.invite_code);
        shareInvite(data.room.invite_code);
        connectWs(data.room.room_id);
        pollRoom(data.room.room_id);
      } catch (e) {
        hooks.toast(e.message || 'Ошибка');
      }
      return;
    }
    // quick
    state.screen = 'search';
    render();
    try {
      var q = await api('/api/sea/quick', {
        method: 'POST',
        body: JSON.stringify({ stake: state.stake }),
      });
      if (q.status === 'matched') {
        state.room = q.room;
        state.screen = 'vs';
        connectWs(q.room.room_id);
        render();
        startCountdown();
      } else {
        // wait for WS/broadcast via polling
        pollQueue();
      }
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
      // fallback local
      startPractice();
    }
  }

  async function joinPrivate() {
    var code = state.inviteCode || (document.getElementById('sb-invite') || {}).value;
    if (!code) {
      hooks.toast('Введи код');
      return;
    }
    try {
      var data = await api('/api/sea/join', {
        method: 'POST',
        body: JSON.stringify({ code: code }),
      });
      state.room = data.room;
      state.screen = 'vs';
      connectWs(data.room.room_id);
      render();
      startCountdown();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function startPractice() {
    hooks.haptic('medium');
    if (apiBase()) {
      try {
        var data = await api('/api/sea/practice', {
          method: 'POST',
          body: JSON.stringify({ stake: state.stake }),
        });
        state.local = false;
        state.room = data.room;
        if (data.room && data.room.balance != null) state.coins = data.room.balance;
        state.screen = 'vs';
        connectWs(data.room.room_id);
        render();
        startCountdown();
        return;
      } catch (e) {
        hooks.toast(e.message || 'Локальный режим');
      }
    }
    state.local = true;
    state.room = {
      room_id: 'local',
      stake: state.stake,
      pot: state.stake * 2,
      status: 'PLACING',
      turn: state.userId,
      players: [
        { user_id: state.userId, name: state.name, level: state.level, avatar: state.avatarLetter || (state.name || '?')[0], photo_url: state.photoUrl },
        { user_id: -1, name: 'Shift AI', level: state.level, avatar: 'S', is_bot: true },
      ],
      enemy: { name: 'Shift AI', level: state.level, is_bot: true, avatar: 'S' },
    };
    state.screen = 'vs';
    render();
    startCountdown();
  }

  var pollTimer = null;
  function pollQueue() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      try {
        var data = await api('/api/sea/status');
        if (data.status === 'matched' && data.room) {
          clearInterval(pollTimer);
          state.room = data.room;
          state.screen = 'vs';
          connectWs(data.room.room_id);
          render();
          startCountdown();
        }
      } catch (e) {}
    }, 1200);
  }

  function pollRoom(roomId) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      try {
        var data = await api('/api/sea/room/' + roomId);
        state.room = data.room;
        if (data.room.balance != null) state.coins = data.room.balance;
        if (data.room.status === 'PLACING' && (data.room.players || []).length >= 2) {
          clearInterval(pollTimer);
          state.screen = 'vs';
          render();
          startCountdown();
        }
      } catch (e) {}
    }, 1500);
  }

  async function loadLeaderboard() {
    state.screen = 'board';
    render();
    if (!apiBase() && !hooks.apiFetch) {
      state.leaderboard = [];
      render();
      return;
    }
    try {
      var data = await api('/api/rating');
      state.leaderboard = (data.rows || []).map(function (r) {
        return {
          rank: r.rank,
          name: r.name,
          wins: r.rating,
          win_rate: r.league,
          coins_won: r.rating,
        };
      });
      render();
    } catch (e) {
      try {
        var data2 = await api('/api/sea/leaderboard?period=' + state.boardPeriod);
        state.leaderboard = data2.rows || [];
        render();
      } catch (e2) {
        state.leaderboard = [];
        render();
      }
    }
  }

  async function loadProfile() {
    state.screen = 'profile';
    render();
    if (!apiBase()) return;
    try {
      var data = await api('/api/sea/me');
      state.stats = data.stats;
      if (data.user) state.coins = data.user.coins;
      render();
    } catch (e) {}
  }

  function shareInvite(code) {
    var tg = hooks.getTg();
    var text = '⚓ ' + state.name + ' вызывает тебя на Морской бой\nСтавка: ' + state.stake + ' S-Coins\nКод: ' + code;
    if (tg && tg.openTelegramLink) {
      // share via t.me share
    }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    } else {
      hooks.toast('Код скопирован: ' + code);
      try { navigator.clipboard.writeText(code); } catch (e) {}
    }
  }

  function shareChallenge() {
    var text = '⚓ Я вызываю тебя на Морской бой!\nСтавка: ' + state.stake + ' S-Coins\nПримешь вызов?';
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else hooks.toast(text);
  }

  function open(opts) {
    opts = opts || {};
    Object.assign(hooks, opts.hooks || {});
    state.open = true;
    state.screen = 'lobby';
    state.coins = opts.coins != null ? opts.coins : state.coins;
    state.userId = opts.userId || state.userId;
    state.chatId = opts.chatId || state.chatId || state.userId;
    state.name = opts.name || state.name;
    state.photoUrl = opts.photoUrl || state.photoUrl || '';
    state.avatarLetter = opts.avatar || state.avatarLetter || (state.name || '?')[0];
    state.level = opts.level || state.level;
    state.profileEco = opts.profileEco || state.profileEco;
    state.api = opts.api || state.api || '';
    state.room = null;
    state.local = false;

    // Prefer live Telegram profile each open
    var tg = hooks.getTg && hooks.getTg();
    var tu = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (tu) {
      var nm = [tu.first_name, tu.last_name].filter(Boolean).join(' ').trim();
      if (nm) state.name = nm;
      if (tu.photo_url) state.photoUrl = tu.photo_url;
      if (tu.id) state.userId = tu.id;
      var parts = (state.name || '').split(/\s+/);
      state.avatarLetter = parts.length > 1
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : (state.name[0] || 'И').toUpperCase();
    }

    var host = document.getElementById('seabattle-host');
    if (host) {
      host.classList.add('is-open');
      host.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('sb-active');
    render();
    syncMe();
    var invite = (opts.invite || new URLSearchParams(window.location.search).get('sea_invite') || '').trim();
    if (invite) {
      state.mode = 'private';
      state.inviteCode = invite;
      state.screen = 'stake';
      render();
    }
  }

  async function syncMe() {
    if (!apiBase()) return;
    try {
      var data = await api('/api/sea/me');
      if (data.user) {
        state.coins = data.user.coins;
        state.level = data.user.level || state.level;
        state.name = data.user.name || state.name;
      }
      state.stats = data.stats;
      render();
    } catch (e) {}
  }

  function close() {
    state.open = false;
    clearInterval(pollTimer);
    if (state.ws) try { state.ws.close(); } catch (e) {}
    var host = document.getElementById('seabattle-host');
    if (host) {
      host.classList.remove('is-open');
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '';
    }
    document.body.classList.remove('sb-active');
    if (hooks.onExit) hooks.onExit();
  }

  function isOpen() { return state.open; }

  function handleBack() {
    if (!state.open) return false;
    if (state.screen === 'lobby' || state.screen === 'battle' || state.screen === 'result') {
      close();
      return true;
    }
    state.screen = 'lobby';
    render();
    return true;
  }

  global.ShiftSeaBattle = {
    open: open,
    close: close,
    isOpen: isOpen,
    handleBack: handleBack,
  };
})(window);
