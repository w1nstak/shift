/* Shift — iOS-style Telegram Mini App */
(function () {
  'use strict';

  var STORE_KEY = 'shift-app-v1';

  /* ========== Telegram ========== */
  var tg = null;

  function getTg() {
    return tg || (window.Telegram && window.Telegram.WebApp) || null;
  }

  function haptic(style) {
    if (store.settings && store.settings.haptics === false) return;
    var fb = tg && tg.HapticFeedback;
    if (!fb) return;
    try {
      if (style === 'success' && fb.notificationOccurred) return fb.notificationOccurred('success');
      if (style === 'error' && fb.notificationOccurred) return fb.notificationOccurred('error');
      if (style === 'selection' && fb.selectionChanged) return fb.selectionChanged();
      if (fb.impactOccurred) fb.impactOccurred({ light: 'light', medium: 'medium', heavy: 'heavy' }[style] || 'light');
    } catch (e) {}
  }

  function initTelegram(hooks) {
    tg = getTg();
    if (!tg) return null;
    tg.ready();
    tg.expand();
    try {
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    } catch (e) {}
    try {
      if (tg.setHeaderColor) tg.setHeaderColor('#1769FF');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#1769FF');
    } catch (e) {}
    if (typeof tg.onEvent === 'function') {
      tg.onEvent('themeChanged', function () {});
    }
    if (tg.BackButton) {
      tg.BackButton.onClick(function () {
        haptic('light');
        if (hooks && hooks.onBack) hooks.onBack();
      });
    }
    if (tg.MainButton) tg.MainButton.hide();
    return tg;
  }

  function setBackVisible(on) {
    if (!tg || !tg.BackButton) return;
    if (on) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  /* ========== Store ========== */
  function defaultStore() {
    return {
      user: { name: 'Игрок', shiftId: '@player', avatar: 'И' },
      settings: { haptics: true, sounds: true },
      stats: { gamesPlayed: 0, bestMath: 0, bestTap: 0, streak: 1, messages: 0 },
      achievements: {},
      messages: {},
      chats: null,
    };
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultStore();
      var parsed = JSON.parse(raw);
      var base = defaultStore();
      return Object.assign(base, parsed, {
        user: Object.assign(base.user, parsed.user || {}),
        settings: Object.assign(base.settings, parsed.settings || {}),
        stats: Object.assign(base.stats, parsed.stats || {}),
        achievements: Object.assign({}, parsed.achievements || {}),
        messages: Object.assign({}, parsed.messages || {}),
      });
    } catch (e) {
      return defaultStore();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  var store = loadStore();

  var CHATS_SEED = [
    { id: 'shift-ai', name: 'Shift AI', preview: 'Чем могу помочь?', time: 'сейчас', unread: 0, type: 'ai', color: 'ai', avatar: '✨', iconBg: 'bg-teal' },
    { id: 'masha', name: 'Маша', preview: 'Ок, давай в 19:00', time: '12:40', unread: 2, type: 'personal', color: 'pink', avatar: 'М', iconBg: 'bg-pink' },
    { id: 'dev', name: 'Shift Dev', preview: 'Новый билд готов', time: '11:02', unread: 0, type: 'group', color: 'violet', avatar: 'D', iconBg: 'bg-purple' },
    { id: 'leo', name: 'Leo', preview: 'Залетай в Math Battle', time: 'вчера', unread: 1, type: 'personal', color: 'green', avatar: 'L', iconBg: 'bg-green' },
    { id: 'team', name: 'Команда Shift', preview: 'Daily Challenge открыт', time: 'вчера', unread: 3, type: 'group', color: 'violet', avatar: 'S', iconBg: 'bg-blue' },
  ];

  if (!store.chats) store.chats = CHATS_SEED.map(function (c) { return Object.assign({}, c); });

  var GAMES = [
    { id: 'math', name: 'Math Battle', desc: 'Считай быстрее всех', emoji: '🧠', difficulty: 'Средняя', featured: true },
    { id: 'tap', name: 'Quick Tap', desc: 'Нажми цель как можно чаще', emoji: '🎯', difficulty: 'Лёгкая' },
    { id: 'daily', name: 'Daily Challenge', desc: 'Ежедневный Math Battle', emoji: '🏆', difficulty: 'Челлендж' },
  ];

  var AI_ACTIONS = [
    { id: 'create', title: 'Создать', sub: 'Идеи и черновики', icon: '✨' },
    { id: 'search', title: 'Найти', sub: 'Ответы и факты', icon: '🔎' },
    { id: 'write', title: 'Написать', sub: 'Тексты и посты', icon: '📝' },
    { id: 'plan', title: 'Спланировать', sub: 'День и задачи', icon: '🎯' },
    { id: 'image', title: 'Создать изображение', sub: 'Визуальные идеи', icon: '🎨' },
    { id: 'task', title: 'Выполнить', sub: 'Быстрые шаги', icon: '⚡' },
  ];

  var ACHIEVEMENTS = [
    { id: 'first_game', title: 'Первая игра', sub: 'Сыграй любую игру', icon: '🎮' },
    { id: 'math_200', title: 'Считака', sub: 'Набери 200 в Math Battle', icon: '🧠' },
    { id: 'tap_40', title: 'Реактив', sub: '40 тапов в Quick Tap', icon: '🎯' },
    { id: 'chatty', title: 'Собеседник', sub: '10 сообщений Shift', icon: '💬' },
  ];

  /* ========== UI state ========== */
  var ui = {
    tab: 'home',
    overlay: null,
    chatId: null,
    chatFilter: 'all',
    chatSearch: '',
    typing: false,
    game: null,
    sheet: null,
    navDir: 'push',
  };

  var refs = {
    host: document.getElementById('screen-host'),
    nav: document.getElementById('bottom-nav'),
    root: document.getElementById('shift-root'),
    toast: document.getElementById('toast-host'),
    sheet: document.getElementById('sheet-host'),
  };

  var NAV = [
    { id: 'home', label: 'Главная', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5H14v-6H10v6H5.5A1.5 1.5 0 0 1 4 19v-8Z"/></svg>' },
    { id: 'chats', label: 'Чаты', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 3.5V6.5Z"/></svg>' },
    { id: 'ai', label: 'Shift', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M3 12c2.4-5 5.8-7.5 9-7.5S18.6 7 21 12c-2.4 5-5.8 7.5-9 7.5S5.4 17 3 12Z"/></svg>' },
    { id: 'games', label: 'Игры', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5.5" y="7" width="13" height="10" rx="3"/><path d="M9 12h6M12 9.5v5"/></svg>' },
    { id: 'profile', label: 'Профиль', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.5-2.8 4-4.2 7-4.2s5.5 1.4 7 4.2"/></svg>' },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(text) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    refs.toast.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-show'); });
    setTimeout(function () {
      el.classList.remove('is-show');
      setTimeout(function () { el.remove(); }, 220);
    }, 1600);
  }

  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 18) return 'Добрый день';
    return 'Добрый вечер';
  }

  function nowLabel() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function unlock(id) {
    if (store.achievements[id]) return;
    store.achievements[id] = true;
    saveStore();
    var a = ACHIEVEMENTS.find(function (x) { return x.id === id; });
    if (a) toast('Достижение: ' + a.title);
    haptic('success');
  }

  function countAchievements() {
    return Object.keys(store.achievements).filter(function (k) { return store.achievements[k]; }).length;
  }

  /* ========== Nav ========== */
  function renderNav() {
    var hide = ui.overlay === 'chat' || ui.overlay === 'play';
    refs.nav.classList.toggle('is-hidden', hide);
    refs.nav.innerHTML = NAV.map(function (item) {
      return '<button type="button" class="shift-nav__item' + (ui.tab === item.id && !ui.overlay ? ' is-active' : '') + '" data-tab="' + item.id + '">' +
        '<span class="shift-nav__icon">' + item.icon + '</span><small>' + esc(item.label) + '</small></button>';
    }).join('');
    refs.nav.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        haptic('selection');
        ui.overlay = null;
        ui.navDir = 'push';
        ui.tab = btn.dataset.tab;
        route();
      });
    });
  }

  /* ========== Screens ========== */
  function renderHome() {
    var recent = store.chats.filter(function (c) { return c.id !== 'shift-ai'; }).slice(0, 3);
    var unread = store.chats.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    return (
      '<section class="screen is-active">' +
        '<p class="greeting">' + greeting() + '</p>' +
        '<h1 class="large-title">' + esc(store.user.name) + '</h1>' +
        '<div class="stats-grid">' +
          '<div class="stat-card"><small>Стрик</small><strong>' + store.stats.streak + '</strong><span>дней подряд</span></div>' +
          '<div class="stat-card"><small>Рекорд</small><strong>' + Math.max(store.stats.bestMath, store.stats.bestTap) + '</strong><span>лучший счёт</span></div>' +
        '</div>' +

        '<p class="section-label">Ярлыки</p>' +
        '<div class="shortcuts">' +
          '<button type="button" class="shortcut" data-go="ai"><span class="shortcut__icon bg-teal">✨</span><span>Shift</span></button>' +
          '<button type="button" class="shortcut" data-go="chats"><span class="shortcut__icon bg-blue">💬</span><span>Чаты' + (unread ? ' · ' + unread : '') + '</span></button>' +
          '<button type="button" class="shortcut" data-play="math"><span class="shortcut__icon bg-orange">🧠</span><span>Math</span></button>' +
          '<button type="button" class="shortcut" data-play="tap"><span class="shortcut__icon bg-pink">🎯</span><span>Tap</span></button>' +
        '</div>' +

        '<div class="section-row"><p class="section-label">Недавние</p><button type="button" class="see-all" data-go="chats">Все</button></div>' +
        '<div class="group">' +
          '<button type="button" class="row" data-open-chat="shift-ai">' +
            '<span class="row__icon bg-teal">✨</span>' +
            '<span class="row__body"><span class="row__title">Shift AI</span><span class="row__sub">Спросить что угодно</span></span>' +
            '<span class="chevron">›</span></button>' +
          recent.map(function (c) {
            return '<button type="button" class="row" data-open-chat="' + c.id + '">' +
              '<span class="row__icon ' + c.iconBg + '">' + esc(c.avatar) + '</span>' +
              '<span class="row__body"><span class="row__title">' + esc(c.name) + '</span><span class="row__sub">' + esc(c.preview) + '</span></span>' +
              (c.unread ? '<span class="badge">' + c.unread + '</span>' : '<span class="row__meta">' + esc(c.time) + '</span>') +
              '<span class="chevron">›</span></button>';
          }).join('') +
        '</div>' +

        '<p class="section-label">Продолжить</p>' +
        '<div class="group">' +
          '<button type="button" class="row" data-play="daily">' +
            '<span class="row__icon bg-orange">🏆</span>' +
            '<span class="row__body"><span class="row__title">Daily Challenge</span><span class="row__sub">Math Battle · сегодня</span></span>' +
            '<span class="chevron">›</span></button>' +
          '<button type="button" class="row" data-go="games">' +
            '<span class="row__icon bg-purple">🎮</span>' +
            '<span class="row__body"><span class="row__title">Shift Games</span><span class="row__sub">Сыграно: ' + store.stats.gamesPlayed + '</span></span>' +
            '<span class="chevron">›</span></button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderChats() {
    var q = (ui.chatSearch || '').toLowerCase();
    var list = store.chats.filter(function (c) {
      if (c.id === 'shift-ai') return false;
      if (ui.chatFilter === 'personal' && c.type !== 'personal') return false;
      if (ui.chatFilter === 'group' && c.type !== 'group') return false;
      if (ui.chatFilter === 'ai') return false;
      if (q && c.name.toLowerCase().indexOf(q) === -1 && c.preview.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var filters = [
      { id: 'all', label: 'Все' },
      { id: 'personal', label: 'Личные' },
      { id: 'group', label: 'Группы' },
      { id: 'ai', label: 'AI' },
    ];
    return (
      '<section class="screen is-active">' +
        '<h1 class="large-title">Чаты</h1>' +
        '<div class="search">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>' +
          '<input id="chat-search" type="search" placeholder="Поиск" value="' + esc(ui.chatSearch) + '" enterkeyhint="search" />' +
        '</div>' +
        '<div class="segmented">' +
          filters.map(function (f) {
            return '<button type="button" class="' + (ui.chatFilter === f.id ? 'is-active' : '') + '" data-filter="' + f.id + '">' + f.label + '</button>';
          }).join('') +
        '</div>' +
        '<button type="button" class="banner" data-open-chat="shift-ai">' +
          '<span class="banner__icon">✨</span>' +
          '<span><strong>Shift AI</strong><span>Чем могу помочь?</span></span>' +
          '<span class="chevron" style="color:#fff;margin-left:auto">›</span>' +
        '</button>' +
        (ui.chatFilter === 'ai' ? '' : (
          '<div class="group">' +
            (list.length ? list.map(function (c) {
              return '<button type="button" class="row" data-open-chat="' + c.id + '">' +
                '<span class="row__icon ' + c.iconBg + '">' + esc(c.avatar) + '</span>' +
                '<span class="row__body"><span class="row__title">' + esc(c.name) + '</span><span class="row__sub">' + esc(c.preview) + '</span></span>' +
                (c.unread ? '<span class="badge">' + c.unread + '</span>' : '<span class="row__meta">' + esc(c.time) + '</span>') +
                '<span class="chevron">›</span></button>';
            }).join('') : '<div class="row"><span class="row__body"><span class="row__sub">Ничего не найдено</span></span></div>') +
          '</div>'
        )) +
      '</section>'
    );
  }

  function ensureMessages(chatId) {
    if (store.messages[chatId] && store.messages[chatId].length) return store.messages[chatId];
    if (chatId === 'shift-ai') {
      store.messages[chatId] = [{ from: 'shift', text: 'Привет! Я Shift 👋\nЧто сделаем сегодня?' }];
    } else {
      var chat = store.chats.find(function (c) { return c.id === chatId; });
      store.messages[chatId] = [
        { from: 'shift', text: chat ? chat.preview : 'Привет!' },
      ];
    }
    saveStore();
    return store.messages[chatId];
  }

  function renderChatThread() {
    var chat = store.chats.find(function (c) { return c.id === ui.chatId; }) || { name: 'Чат', avatar: '?' };
    var isAi = ui.chatId === 'shift-ai';
    var msgs = ensureMessages(ui.chatId);
    return (
      '<section class="screen is-active">' +
        '<div class="thread">' +
          '<div class="thread__bar">' +
            '<button type="button" class="back" data-back aria-label="Назад">‹</button>' +
            '<div class="thread__who"><strong>' + esc(chat.name) + '</strong><span>' + (isAi ? 'онлайн' : 'в сети') + '</span></div>' +
            '<span></span>' +
          '</div>' +
          '<div class="messages" id="msg-list">' +
            msgs.map(function (m) {
              var cls = m.from === 'user' ? 'bubble bubble--me' : 'bubble bubble--them';
              return '<div class="' + cls + '">' + esc(m.text).replace(/\n/g, '<br/>') + '</div>';
            }).join('') +
            (ui.typing ? '<div class="typing">Shift печатает…</div>' : '') +
          '</div>' +
          (isAi ? (
            '<div class="suggest">' +
              AI_ACTIONS.slice(0, 4).map(function (a) {
                return '<button type="button" data-ai-prompt="' + esc(a.title) + '">' + a.icon + ' ' + esc(a.title) + '</button>';
              }).join('') +
            '</div>'
          ) : '') +
          '<div class="composer-bar">' +
            '<button type="button" class="tool" data-attach aria-label="Вложение">＋</button>' +
            '<textarea id="composer-input" class="composer-field" rows="1" placeholder="Сообщение" enterkeyhint="send"></textarea>' +
            '<button type="button" class="composer-send" id="composer-send" data-send aria-label="Отправить">↑</button>' +
          '</div>' +
          '<input id="file-input" type="file" accept="image/*,.pdf,.txt" hidden />' +
        '</div>' +
      '</section>'
    );
  }

  function renderAI() {
    return (
      '<section class="screen is-active">' +
        '<p class="greeting">Ассистент</p>' +
        '<h1 class="large-title">Привет! Я Shift 👋</h1>' +
        '<p class="subtitle">Что сделаем сегодня?</p>' +
        '<div class="ai-grid" style="margin-top:18px">' +
          AI_ACTIONS.map(function (a) {
            return '<button type="button" class="ai-tile" data-ai-start="' + a.id + '">' +
              '<div><div class="ai-tile__icon">' + a.icon + '</div><strong>' + esc(a.title) + '</strong><span>' + esc(a.sub) + '</span></div></button>';
          }).join('') +
        '</div>' +
        '<div style="margin-top:16px">' +
          '<button type="button" class="btn btn--primary btn--wide" data-open-chat="shift-ai">Открыть чат</button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderGames() {
    return (
      '<section class="screen is-active">' +
        '<p class="greeting">Shift Games</p>' +
        '<h1 class="large-title">Игры</h1>' +
        '<p class="subtitle">Небольшие игры, чтобы развлечься и получить награды.</p>' +
        '<div style="margin-top:16px">' +
          '<button type="button" class="featured" data-play="daily">' +
            '<span class="tag">Daily Challenge</span>' +
            '<h3>Math Battle</h3>' +
            '<p>Сегодняшний челлендж · рекорд ' + store.stats.bestMath + '</p>' +
            '<span class="btn btn--primary" style="min-height:40px;padding:0 16px;font-size:15px">Играть</span>' +
          '</button>' +
        '</div>' +
        '<p class="section-label">Все игры</p>' +
        '<div class="group">' +
          GAMES.map(function (g) {
            var best = g.id === 'tap' ? store.stats.bestTap : store.stats.bestMath;
            return '<button type="button" class="row" data-play="' + g.id + '">' +
              '<span class="game-art">' + g.emoji + '</span>' +
              '<span class="row__body"><span class="row__title">' + esc(g.name) + '</span><span class="row__sub">' + esc(g.desc) + ' · ' + esc(g.difficulty) + '</span></span>' +
              '<span class="row__meta">' + best + '</span>' +
              '<span class="chevron">›</span></button>';
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function renderProfile() {
    return (
      '<section class="screen is-active">' +
        '<h1 class="large-title">Мой Shift</h1>' +
        '<div class="profile-card" style="margin-top:12px">' +
          '<div class="avatar-xl">' + esc(store.user.avatar) + '</div>' +
          '<h2>' + esc(store.user.name) + '</h2>' +
          '<span class="id">' + esc(store.user.shiftId) + '</span>' +
          '<div class="p-stats">' +
            '<div><strong>' + store.stats.gamesPlayed + '</strong><small>Игры</small></div>' +
            '<div><strong>' + store.stats.messages + '</strong><small>Чаты</small></div>' +
            '<div><strong>' + countAchievements() + '</strong><small>Награды</small></div>' +
          '</div>' +
        '</div>' +
        '<p class="section-label">Аккаунт</p>' +
        '<div class="group">' +
          '<button type="button" class="row" data-sheet="achievements"><span class="row__icon bg-orange">🏆</span><span class="row__body"><span class="row__title">Достижения</span><span class="row__sub">' + countAchievements() + ' из ' + ACHIEVEMENTS.length + '</span></span><span class="chevron">›</span></button>' +
          '<button type="button" class="row" data-sheet="history"><span class="row__icon bg-purple">🎮</span><span class="row__body"><span class="row__title">История игр</span><span class="row__sub">Math ' + store.stats.bestMath + ' · Tap ' + store.stats.bestTap + '</span></span><span class="chevron">›</span></button>' +
          '<button type="button" class="row" data-sheet="settings"><span class="row__icon bg-blue">⚙️</span><span class="row__body"><span class="row__title">Настройки</span><span class="row__sub">Хаптик и данные</span></span><span class="chevron">›</span></button>' +
        '</div>' +
      '</section>'
    );
  }

  /* ========== Games ========== */
  function clearGameTimer() {
    if (ui.game && ui.game.timerId) {
      clearInterval(ui.game.timerId);
      ui.game.timerId = null;
    }
  }

  function startMathBattle() {
    clearGameTimer();
    ui.overlay = 'play';
    ui.game = {
      kind: 'math',
      score: 0,
      time: 30,
      total: 30,
      over: false,
      question: null,
      timerId: null,
    };
    nextMathQuestion();
    route();
    ui.game.timerId = setInterval(function () {
      if (!ui.game || ui.game.over || ui.game.kind !== 'math') return;
      ui.game.time -= 1;
      var bar = document.getElementById('timer-fill');
      var label = document.getElementById('timer-label');
      if (bar) bar.style.width = Math.max(0, (ui.game.time / ui.game.total) * 100) + '%';
      if (label) label.textContent = formatTime(ui.game.time);
      if (ui.game.time <= 0) finishGame();
    }, 1000);
  }

  function startQuickTap() {
    clearGameTimer();
    ui.overlay = 'play';
    ui.game = {
      kind: 'tap',
      score: 0,
      time: 15,
      total: 15,
      over: false,
      timerId: null,
    };
    route();
    ui.game.timerId = setInterval(function () {
      if (!ui.game || ui.game.over || ui.game.kind !== 'tap') return;
      ui.game.time -= 1;
      var bar = document.getElementById('timer-fill');
      var label = document.getElementById('timer-label');
      if (bar) bar.style.width = Math.max(0, (ui.game.time / ui.game.total) * 100) + '%';
      if (label) label.textContent = formatTime(ui.game.time);
      if (ui.game.time <= 0) finishGame();
    }, 1000);
  }

  function formatTime(s) {
    var m = Math.floor(s / 60);
    var r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function nextMathQuestion() {
    var a = 2 + Math.floor(Math.random() * 12);
    var b = 2 + Math.floor(Math.random() * 12);
    var op = Math.random() > 0.4 ? '×' : '+';
    var answer = op === '×' ? a * b : a + b;
    var opts = {};
    opts[answer] = true;
    while (Object.keys(opts).length < 4) {
      var delta = (1 + Math.floor(Math.random() * 8)) * (Math.random() > 0.5 ? 1 : -1);
      opts[Math.max(1, answer + delta)] = true;
    }
    var options = Object.keys(opts).map(Number).sort(function () { return Math.random() - 0.5; });
    ui.game.question = { a: a, b: b, op: op, answer: answer, options: options };
  }

  function finishGame() {
    if (!ui.game || ui.game.over) return;
    ui.game.over = true;
    clearGameTimer();
    store.stats.gamesPlayed += 1;
    unlock('first_game');
    if (ui.game.kind === 'math') {
      if (ui.game.score > store.stats.bestMath) store.stats.bestMath = ui.game.score;
      if (ui.game.score >= 200) unlock('math_200');
    }
    if (ui.game.kind === 'tap') {
      if (ui.game.score > store.stats.bestTap) store.stats.bestTap = ui.game.score;
      if (ui.game.score >= 40) unlock('tap_40');
    }
    saveStore();
    haptic('success');
    route();
  }

  function renderPlay() {
    var g = ui.game;
    if (!g) return '';

    if (g.over) {
      return (
        '<section class="screen is-active"><div class="play">' +
          '<div class="result">' +
            '<div class="emoji">🎉</div>' +
            '<h2>Отлично!</h2>' +
            '<p>Ваш результат: <strong>' + g.score + '</strong></p>' +
            '<div class="actions">' +
              '<button type="button" class="btn btn--blue btn--wide" data-replay>Играть ещё</button>' +
              '<button type="button" class="btn btn--ghost btn--wide" data-back-games style="color:#1769FF;background:#F2F2F7">В игры</button>' +
            '</div>' +
          '</div>' +
        '</div></section>'
      );
    }

    if (g.kind === 'tap') {
      return (
        '<section class="screen is-active"><div class="play">' +
          '<div class="play__top"><button type="button" class="back" data-back>‹</button><h1>Quick Tap</h1><span></span></div>' +
          '<div class="score-panel"><small>Тапы</small><strong id="score-value">' + g.score + '</strong></div>' +
          '<div class="progress"><i id="timer-fill" style="width:' + ((g.time / g.total) * 100) + '%"></i></div>' +
          '<div class="timer-text" id="timer-label">' + formatTime(g.time) + '</div>' +
          '<button type="button" class="tap-zone" id="tap-zone"><span class="tap-target"></span></button>' +
        '</div></section>'
      );
    }

    var q = g.question;
    return (
      '<section class="screen is-active"><div class="play">' +
        '<div class="play__top"><button type="button" class="back" data-back>‹</button><h1>Math Battle</h1><span></span></div>' +
        '<div class="score-panel"><small>Счёт</small><strong id="score-value">' + g.score + '</strong></div>' +
        '<div class="progress"><i id="timer-fill" style="width:' + ((g.time / g.total) * 100) + '%"></i></div>' +
        '<div class="timer-text" id="timer-label">' + formatTime(g.time) + '</div>' +
        '<div class="q-card"><small>Решите пример</small><strong>' + q.a + ' ' + q.op + ' ' + q.b + ' = ?</strong></div>' +
        '<div class="answers">' +
          q.options.map(function (opt) {
            return '<button type="button" class="answer" data-answer="' + opt + '">' + opt + '</button>';
          }).join('') +
        '</div>' +
      '</div></section>'
    );
  }

  function playGame(id) {
    haptic('medium');
    if (id === 'math' || id === 'daily') return startMathBattle();
    if (id === 'tap') return startQuickTap();
    startMathBattle();
  }

  /* ========== Chat logic ========== */
  function shiftReply(text) {
    var t = text.toLowerCase();
    if (t.indexOf('игр') !== -1 || t.indexOf('math') !== -1) return 'Открой Shift Games → Math Battle или Quick Tap. Могу подсказать стратегию.';
    if (t.indexOf('план') !== -1) return 'План на сегодня:\n1) Цель\n2) 3 шага\n3) Дедлайн\nНапиши цель — разложу.';
    if (t.indexOf('картин') !== -1 || t.indexOf('изображ') !== -1) return 'Опиши сцену в 1–2 предложениях: стиль, свет, объект. Соберу промпт.';
    if (t.indexOf('найти') !== -1 || t.indexOf('поиск') !== -1) return 'Что ищем? Могу сузить запрос и предложить варианты.';
    if (t.indexOf('привет') !== -1) return 'Привет! Чем займёмся — чат, игра или задача?';
    return 'Принял. Уточни детали — сделаю следующий шаг.';
  }

  function updateChatPreview(chatId, text) {
    store.chats = store.chats.map(function (c) {
      if (c.id !== chatId) return c;
      return Object.assign({}, c, { preview: text.slice(0, 42), time: nowLabel(), unread: 0 });
    });
  }

  function sendChatMessage(text) {
    if (!ui.chatId || !text) return;
    var list = ensureMessages(ui.chatId);
    list.push({ from: 'user', text: text });
    store.stats.messages += 1;
    if (store.stats.messages >= 10) unlock('chatty');
    updateChatPreview(ui.chatId, text);
    saveStore();
    haptic('light');

    if (ui.chatId === 'shift-ai') {
      ui.typing = true;
      route();
      scrollMessages();
      setTimeout(function () {
        ui.typing = false;
        ensureMessages('shift-ai').push({ from: 'shift', text: shiftReply(text) });
        updateChatPreview('shift-ai', shiftReply(text));
        saveStore();
        route();
        scrollMessages();
      }, 650 + Math.random() * 500);
      return;
    }

    setTimeout(function () {
      ensureMessages(ui.chatId).push({ from: 'shift', text: 'Ок 👍' });
      saveStore();
      if (ui.overlay === 'chat') {
        route();
        scrollMessages();
      }
    }, 500);
    route();
    scrollMessages();
  }

  function scrollMessages() {
    requestAnimationFrame(function () {
      var box = document.getElementById('msg-list');
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  /* ========== Sheets ========== */
  function openSheet(kind) {
    ui.sheet = kind;
    var html = '';
    if (kind === 'settings') {
      html =
        '<div class="sheet">' +
          '<div class="sheet__handle"></div><h3>Настройки</h3>' +
          '<div class="group">' +
            '<button type="button" class="toggle-row" data-toggle="haptics"><span>Тактильный отклик</span><span class="toggle' + (store.settings.haptics ? ' is-on' : '') + '" id="tog-haptics"></span></button>' +
          '</div>' +
          '<div class="group" style="margin-top:12px">' +
            '<button type="button" class="row" data-reset><span class="row__body"><span class="row__title" style="color:#FF3B30">Сбросить данные</span></span></button>' +
          '</div>' +
          '<button type="button" class="btn btn--primary btn--wide" style="margin-top:16px" data-close-sheet>Закрыть</button>' +
        '</div>';
    } else if (kind === 'achievements') {
      html =
        '<div class="sheet">' +
          '<div class="sheet__handle"></div><h3>Достижения</h3>' +
          '<div class="group">' +
            ACHIEVEMENTS.map(function (a) {
              var on = !!store.achievements[a.id];
              return '<div class="row"><span class="row__icon ' + (on ? 'bg-orange' : 'bg-blue') + '" style="opacity:' + (on ? 1 : 0.45) + '">' + a.icon + '</span>' +
                '<span class="row__body"><span class="row__title">' + esc(a.title) + '</span><span class="row__sub">' + esc(a.sub) + (on ? ' · получено' : '') + '</span></span></div>';
            }).join('') +
          '</div>' +
          '<button type="button" class="btn btn--primary btn--wide" style="margin-top:16px" data-close-sheet>Закрыть</button>' +
        '</div>';
    } else {
      html =
        '<div class="sheet">' +
          '<div class="sheet__handle"></div><h3>История игр</h3>' +
          '<div class="group">' +
            '<div class="row"><span class="row__body"><span class="row__title">Math Battle</span><span class="row__sub">Лучший счёт</span></span><span class="row__meta">' + store.stats.bestMath + '</span></div>' +
            '<div class="row"><span class="row__body"><span class="row__title">Quick Tap</span><span class="row__sub">Лучший счёт</span></span><span class="row__meta">' + store.stats.bestTap + '</span></div>' +
            '<div class="row"><span class="row__body"><span class="row__title">Всего игр</span></span><span class="row__meta">' + store.stats.gamesPlayed + '</span></div>' +
          '</div>' +
          '<button type="button" class="btn btn--primary btn--wide" style="margin-top:16px" data-close-sheet>Закрыть</button>' +
        '</div>';
    }
    refs.sheet.innerHTML = html;
    refs.sheet.classList.add('is-open');
    refs.sheet.setAttribute('aria-hidden', 'false');
    bindSheet();
  }

  function closeSheet() {
    ui.sheet = null;
    refs.sheet.classList.remove('is-open');
    refs.sheet.setAttribute('aria-hidden', 'true');
    refs.sheet.innerHTML = '';
  }

  function bindSheet() {
    var closeBtn = refs.sheet.querySelector('[data-close-sheet]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        haptic('light');
        closeSheet();
      });
    }
    refs.sheet.addEventListener('click', function (e) {
      if (e.target === refs.sheet) closeSheet();
    });
    var tog = refs.sheet.querySelector('[data-toggle="haptics"]');
    if (tog) {
      tog.addEventListener('click', function () {
        store.settings.haptics = !store.settings.haptics;
        saveStore();
        haptic('selection');
        openSheet('settings');
      });
    }
    var reset = refs.sheet.querySelector('[data-reset]');
    if (reset) {
      reset.addEventListener('click', function () {
        if (!confirm('Сбросить весь прогресс Shift?')) return;
        localStorage.removeItem(STORE_KEY);
        store = loadStore();
        store.chats = CHATS_SEED.map(function (c) { return Object.assign({}, c); });
        saveStore();
        closeSheet();
        toast('Данные сброшены');
        route();
      });
    }
  }

  /* ========== Bind ========== */
  function bind() {
    refs.host.querySelectorAll('[data-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('selection');
        ui.overlay = null;
        ui.tab = el.dataset.go;
        route();
      });
    });
    refs.host.querySelectorAll('[data-open-chat]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        ui.chatId = el.dataset.openChat;
        store.chats = store.chats.map(function (c) {
          return c.id === ui.chatId ? Object.assign({}, c, { unread: 0 }) : c;
        });
        saveStore();
        ui.overlay = 'chat';
        ui.navDir = 'push';
        route();
      });
    });
    refs.host.querySelectorAll('[data-play]').forEach(function (el) {
      el.addEventListener('click', function () { playGame(el.dataset.play); });
    });
    refs.host.querySelectorAll('[data-back]').forEach(function (el) {
      el.addEventListener('click', goBack);
    });
    refs.host.querySelectorAll('[data-filter]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('selection');
        ui.chatFilter = el.dataset.filter;
        if (ui.chatFilter === 'ai') {
          ui.chatId = 'shift-ai';
          ui.overlay = 'chat';
        }
        route();
      });
    });
    var search = document.getElementById('chat-search');
    if (search) {
      search.addEventListener('search', function () {
        ui.chatSearch = search.value;
        route();
      });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          ui.chatSearch = search.value;
          route();
        }
      });
    }
    refs.host.querySelectorAll('[data-ai-start]').forEach(function (el) {
      el.addEventListener('click', function () {
        var action = AI_ACTIONS.find(function (a) { return a.id === el.dataset.aiStart; });
        ui.chatId = 'shift-ai';
        ui.overlay = 'chat';
        route();
        if (action) setTimeout(function () { sendChatMessage(action.title); }, 40);
      });
    });
    refs.host.querySelectorAll('[data-ai-prompt]').forEach(function (el) {
      el.addEventListener('click', function () { sendChatMessage(el.dataset.aiPrompt); });
    });

    var input = document.getElementById('composer-input');
    var sendBtn = document.getElementById('composer-send');
    if (input && sendBtn) {
      var syncSend = function () {
        sendBtn.classList.toggle('is-ready', input.value.trim().length > 0);
      };
      input.addEventListener('input', function () {
        syncSend();
        input.style.height = 'auto';
        input.style.height = Math.min(100, input.scrollHeight) + 'px';
      });
      syncSend();
      var doSend = function () {
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.style.height = 'auto';
        sendChatMessage(text);
      };
      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doSend();
        }
      });
    }

    var fileInput = document.getElementById('file-input');
    var attach = refs.host.querySelector('[data-attach]');
    if (attach && fileInput) {
      attach.addEventListener('click', function () {
        haptic('light');
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        if (!fileInput.files || !fileInput.files[0]) return;
        var name = fileInput.files[0].name;
        sendChatMessage('📎 ' + name);
        fileInput.value = '';
      });
    }

    refs.host.querySelectorAll('[data-answer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!ui.game || ui.game.over) return;
        var val = Number(btn.dataset.answer);
        var ok = val === ui.game.question.answer;
        btn.classList.add(ok ? 'ok' : 'bad');
        haptic(ok ? 'success' : 'error');
        if (ok) {
          ui.game.score += 40;
          var scoreEl = document.getElementById('score-value');
          if (scoreEl) {
            scoreEl.textContent = String(ui.game.score);
            scoreEl.classList.add('pop');
            setTimeout(function () { scoreEl.classList.remove('pop'); }, 180);
          }
        }
        setTimeout(function () {
          if (!ui.game || ui.game.over) return;
          nextMathQuestion();
          route();
        }, 220);
      });
    });

    var tapZone = document.getElementById('tap-zone');
    if (tapZone) {
      tapZone.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (!ui.game || ui.game.over || ui.game.kind !== 'tap') return;
        ui.game.score += 1;
        haptic('light');
        var scoreEl = document.getElementById('score-value');
        if (scoreEl) {
          scoreEl.textContent = String(ui.game.score);
          scoreEl.classList.add('pop');
          setTimeout(function () { scoreEl.classList.remove('pop'); }, 120);
        }
      });
    }

    var replay = refs.host.querySelector('[data-replay]');
    if (replay) {
      replay.addEventListener('click', function () {
        if (ui.game && ui.game.kind === 'tap') startQuickTap();
        else startMathBattle();
      });
    }
    var backGames = refs.host.querySelector('[data-back-games]');
    if (backGames) {
      backGames.addEventListener('click', function () {
        clearGameTimer();
        ui.overlay = null;
        ui.game = null;
        ui.tab = 'games';
        route();
      });
    }

    refs.host.querySelectorAll('[data-sheet]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        openSheet(el.dataset.sheet);
      });
    });
  }

  function goBack() {
    haptic('light');
    ui.navDir = 'back';
    if (ui.overlay === 'play') {
      clearGameTimer();
      ui.overlay = null;
      ui.game = null;
      ui.tab = 'games';
      route();
      return;
    }
    if (ui.overlay === 'chat') {
      var wasAi = ui.chatId === 'shift-ai';
      ui.overlay = null;
      ui.chatId = null;
      ui.tab = wasAi ? 'ai' : 'chats';
      route();
    }
  }

  /* ========== Route ========== */
  function route() {
    document.body.dataset.screen = ui.overlay || ui.tab;
    setBackVisible(!!ui.overlay);
    var html = '';
    if (ui.overlay === 'chat') html = renderChatThread();
    else if (ui.overlay === 'play') html = renderPlay();
    else if (ui.tab === 'home') html = renderHome();
    else if (ui.tab === 'chats') html = renderChats();
    else if (ui.tab === 'ai') html = renderAI();
    else if (ui.tab === 'games') html = renderGames();
    else if (ui.tab === 'profile') html = renderProfile();
    else html = renderHome();

    refs.host.innerHTML = html;
    var screen = refs.host.querySelector('.screen');
    if (screen && ui.navDir === 'back') screen.classList.add('is-back');
    renderNav();
    bind();
  }

  function hydrateUser() {
    var params = new URLSearchParams(window.location.search);
    var name = params.get('name');
    if (name) {
      store.user.name = name;
      store.user.avatar = name.trim().charAt(0).toUpperCase() || 'И';
      store.user.shiftId = '@' + name.trim().toLowerCase().replace(/\s+/g, '');
      saveStore();
    }
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      var u = tg.initDataUnsafe.user;
      if (u.first_name) {
        store.user.name = u.first_name;
        store.user.avatar = u.first_name.charAt(0).toUpperCase();
        if (u.username) store.user.shiftId = '@' + u.username;
        saveStore();
      }
    }
  }

  function boot() {
    initTelegram({ onBack: goBack });
    hydrateUser();
    route();
    refs.root.classList.add('is-booted');
  }

  boot();
})();
