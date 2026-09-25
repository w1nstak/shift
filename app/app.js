/* Iris Mini App — unified SPA */
(function () {
  'use strict';

  /* ========== Telegram ========== */
  let tg = null;

  function getTg() {
    return tg || (window.Telegram && window.Telegram.WebApp) || null;
  }

  function haptic(style) {
    const fb = tg && tg.HapticFeedback;
    if (!fb) return;
    try {
      if (style === 'success' && fb.notificationOccurred) return fb.notificationOccurred('success');
      if (style === 'error' && fb.notificationOccurred) return fb.notificationOccurred('error');
      if (fb.impactOccurred) fb.impactOccurred({ light: 'light', medium: 'medium', heavy: 'heavy' }[style] || 'light');
    } catch (e) { /* noop */ }
  }

  function initTelegram(hooks) {
    tg = getTg();
    if (!tg) return null;
    tg.ready();
    tg.expand();
    applyTheme(tg);
    if (typeof tg.onEvent === 'function') {
      tg.onEvent('themeChanged', function () { applyTheme(tg); });
      tg.onEvent('viewportChanged', function () { /* layout uses dvh/safe-area */ });
    }
    if (tg.BackButton) {
      tg.BackButton.onClick(function () {
        haptic('light');
        if (hooks && hooks.onBack) hooks.onBack();
      });
    }
    if (tg.MainButton) {
      tg.MainButton.hide();
    }
    return tg;
  }

  function applyTheme(webApp) {
    if (!webApp) return;
    const tp = webApp.themeParams || {};
    const root = document.documentElement;
    if (tp.button_color) root.style.setProperty('--tg-button', tp.button_color);
    if (tp.button_text_color) root.style.setProperty('--tg-button-text', tp.button_text_color);
    try {
      if (webApp.setHeaderColor) webApp.setHeaderColor('#1769FF');
      if (webApp.setBackgroundColor) webApp.setBackgroundColor('#1769FF');
    } catch (e) { /* noop */ }
  }

  function setBackVisible(on) {
    if (!tg || !tg.BackButton) return;
    if (on) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  let mainButtonHandler = null;
  let mainButtonBound = false;

  function setMainButton(opts) {
    if (!tg || !tg.MainButton) return;
    if (!mainButtonBound) {
      mainButtonBound = true;
      tg.MainButton.onClick(function () {
        haptic('medium');
        if (typeof mainButtonHandler === 'function') mainButtonHandler();
      });
    }
    if (!opts || !opts.visible) {
      mainButtonHandler = null;
      tg.MainButton.hide();
      return;
    }
    mainButtonHandler = opts.onClick || null;
    tg.MainButton.setText(opts.text || 'Далее');
    tg.MainButton.show();
    tg.MainButton.enable();
  }

  /* ========== Mock data ========== */
  const USER = {
    name: 'Артём',
    irisId: '@artem',
    avatar: 'А',
    stats: { games: 24, chats: 128, achievements: 12 },
  };

  const CHATS = [
    { id: 'iris', name: 'Iris AI', preview: 'Чем могу помочь?', time: 'сейчас', unread: 0, type: 'ai', accent: '#00D6A3', avatar: '✨', color: 'ai' },
    { id: 'masha', name: 'Маша', preview: 'Ок, давай в 19:00', time: '12:40', unread: 2, type: 'personal', accent: '#FF7AD9', avatar: 'М', color: 'pink' },
    { id: 'dev', name: 'Iris Dev', preview: 'Новый билд готов', time: '11:02', unread: 0, type: 'group', accent: '#1769FF', avatar: 'D', color: 'violet' },
    { id: 'leo', name: 'Leo', preview: 'Залетай в Math Battle', time: 'вчера', unread: 1, type: 'personal', accent: '#00C2FF', avatar: 'L', color: 'green' },
    { id: 'clan', name: 'Команда Iris', preview: 'Daily Challenge открыт 🏆', time: 'вчера', unread: 5, type: 'group', accent: '#7B8CFF', avatar: 'I', color: 'violet' },
  ];

  const GAMES = [
    { id: 'math', name: 'Math Battle', desc: 'Считай быстрее всех', emoji: '🧠', difficulty: 'Medium', score: 960, featured: true },
    { id: 'tap', name: 'Quick Tap', desc: 'Реакция на скорость', emoji: '🎯', difficulty: 'Easy', score: 420 },
    { id: 'run', name: 'Run Iris', desc: 'Беги и собирай бонусы', emoji: '🏃', difficulty: 'Medium', score: 780 },
    { id: 'puzzle', name: 'Puzzle', desc: 'Собери фигуру за минуту', emoji: '🧩', difficulty: 'Hard', score: 310 },
    { id: 'space', name: 'Space Rush', desc: 'Космический раннер', emoji: '🚀', difficulty: 'Hard', score: 1120 },
    { id: 'daily', name: 'Daily Challenge', desc: 'Ежедневный челлендж', emoji: '🏆', difficulty: 'Daily', score: 0 },
  ];

  const AI_ACTIONS = [
    { id: 'create', title: 'Создать', sub: 'Идеи и черновики', icon: '✨', tone: 'create' },
    { id: 'search', title: 'Найти', sub: 'Ответы и факты', icon: '🔎', tone: 'search' },
    { id: 'write', title: 'Написать', sub: 'Тексты и посты', icon: '📝', tone: 'write' },
    { id: 'plan', title: 'Спланировать', sub: 'День и задачи', icon: '🎯', tone: 'plan' },
    { id: 'image', title: 'Изображение', sub: 'Визуальные идеи', icon: '🎨', tone: 'image' },
    { id: 'task', title: 'Выполнить', sub: 'Быстрые шаги', icon: '⚡', tone: 'task' },
  ];

  const QUICK = [
    { id: 'ai', label: 'Iris AI', icon: '✨', go: 'ai' },
    { id: 'chats', label: 'Чаты', icon: '💬', go: 'chats' },
    { id: 'games', label: 'Игры', icon: '🎮', go: 'games' },
    { id: 'create', label: 'Создать', icon: '⚡', go: 'ai' },
  ];

  /* ========== State / Router ========== */
  const state = {
    tab: 'home',
    overlay: null, // 'chat' | 'play' | null
    chatId: null,
    chatFilter: 'all',
    chatSearch: '',
    messages: {},
    game: null,
  };

  const refs = {
    host: document.getElementById('screen-host'),
    nav: document.getElementById('bottom-nav'),
    root: document.getElementById('iris-root'),
    toast: document.getElementById('toast-host'),
  };

  const NAV = [
    { id: 'home', label: 'Главная', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5H14v-6H10v6H5.5A1.5 1.5 0 0 1 4 19v-8Z"/></svg>' },
    { id: 'chats', label: 'Чаты', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 3.5V6.5Z"/></svg>' },
    { id: 'ai', label: 'Iris', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M3 12c2.4-5 5.8-7.5 9-7.5S18.6 7 21 12c-2.4 5-5.8 7.5-9 7.5S5.4 17 3 12Z"/></svg>' },
    { id: 'games', label: 'Игры', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5.5" y="7" width="13" height="10" rx="3"/><path d="M9 12h6M12 9.5v5M4.5 10.5 3 12l1.5 1.5M19.5 10.5 21 12l-1.5 1.5"/></svg>' },
    { id: 'profile', label: 'Профиль', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.5-2.8 4-4.2 7-4.2s5.5 1.4 7 4.2"/></svg>' },
  ];

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    refs.toast.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-show'); });
    setTimeout(function () {
      el.classList.remove('is-show');
      setTimeout(function () { el.remove(); }, 250);
    }, 1400);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function avatarClass(color) {
    if (color === 'ai') return 'avatar avatar--ai';
    if (color === 'pink') return 'avatar avatar--pink';
    if (color === 'green') return 'avatar avatar--green';
    if (color === 'violet') return 'avatar avatar--violet';
    return 'avatar';
  }

  /* ========== Nav ========== */
  function renderNav() {
    const hide = state.overlay === 'chat' || state.overlay === 'play';
    refs.nav.classList.toggle('is-hidden', hide);
    refs.nav.innerHTML = NAV.map(function (item) {
      return '<button type="button" class="iris-nav__item' + (state.tab === item.id && !state.overlay ? ' is-active' : '') + '" data-tab="' + item.id + '">' +
        '<span class="iris-nav__icon">' + item.icon + '</span><small>' + esc(item.label) + '</small></button>';
    }).join('');
    refs.nav.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        haptic('light');
        state.overlay = null;
        state.tab = btn.dataset.tab;
        route();
      });
    });
  }

  /* ========== Screens ========== */
  function renderHome() {
    const recent = CHATS.slice(0, 4);
    const games = GAMES.slice(0, 4);
    return (
      '<section class="screen is-active" data-name="home">' +
        '<div class="home-hero">' +
          '<div class="home-hero__copy reveal">' +
            '<p class="eyebrow">Iris Ecosystem</p>' +
            '<h1 class="h1">Iris — всё нужное в одном месте</h1>' +
            '<p class="lead">Общайтесь, играйте, создавайте и решайте задачи прямо внутри приложения.</p>' +
          '</div>' +
          '<div class="home-hero__stage reveal reveal-d1">' +
            '<div class="float-card float-card--a"><small>Сейчас онлайн</small><strong class="accent">1.2k</strong></div>' +
            '<div class="float-card float-card--b"><small>Daily Challenge</small><strong>Math Battle</strong></div>' +
            '<div class="phone-mock" aria-hidden="true">' +
              '<div class="phone-mock__frame"><div class="phone-mock__screen">' +
                '<div class="phone-mock__notch"></div>' +
                '<div class="phone-mini-row"><div class="phone-mini-avatar">✨</div><div><strong>Iris AI</strong><span>Чем помочь?</span></div></div>' +
                '<div class="phone-mini-row"><div class="phone-mini-avatar">🧠</div><div><strong>Math Battle</strong><span>Рекорд 960</span></div></div>' +
                '<div class="phone-mini-row"><div class="phone-mini-avatar">💬</div><div><strong>Чаты</strong><span>3 новых</span></div></div>' +
              '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="section-gap reveal reveal-d2">' +
          '<div class="section-head"><h2>Быстрые действия</h2></div>' +
          '<div class="quick-actions">' +
            QUICK.map(function (q) {
              return '<button type="button" class="quick-action" data-go="' + q.go + '"><span class="quick-action__icon">' + q.icon + '</span><span>' + esc(q.label) + '</span></button>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="section-gap reveal reveal-d3">' +
          '<div class="section-head"><h2>Последние чаты</h2><button type="button" class="link" data-go="chats">Все</button></div>' +
          '<div class="h-scroll">' +
            recent.map(function (c) {
              return '<button type="button" class="card mini-chat-card card--press" data-open-chat="' + c.id + '">' +
                '<div class="' + avatarClass(c.color) + '">' + esc(c.avatar) + '</div>' +
                '<div class="mini-chat-card__copy"><strong>' + esc(c.name) + '</strong><span>' + esc(c.preview) + '</span></div></button>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="section-gap reveal reveal-d4">' +
          '<div class="section-head"><h2>Игры</h2><button type="button" class="link" data-go="games">Ещё</button></div>' +
          '<div class="h-scroll">' +
            games.map(function (g) {
              return '<button type="button" class="card game-pill card--press" data-play="' + g.id + '">' +
                '<div class="game-pill__art">' + g.emoji + '</div><strong>' + esc(g.name) + '</strong><span>' + esc(g.desc) + '</span></button>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="section-gap">' +
          '<div class="section-head"><h2>Рекомендации</h2></div>' +
          '<div class="h-scroll">' +
            '<button type="button" class="card reco-card card--press" data-go="ai"><span class="tag">AI</span><strong class="h3">Спроси Iris</strong><p>Идеи, планы и ответы за секунды</p></button>' +
            '<button type="button" class="card reco-card card--press" data-play="daily"><span class="tag">Игра</span><strong class="h3">Daily Challenge</strong><p>Сегодня: Math Battle</p></button>' +
            '<button type="button" class="card reco-card card--press" data-go="chats"><span class="tag">Чаты</span><strong class="h3">Новые сообщения</strong><p>3 непрочитанных диалога</p></button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderChats() {
    const filter = state.chatFilter;
    const q = (state.chatSearch || '').toLowerCase();
    const list = CHATS.filter(function (c) {
      if (c.type === 'ai') return false;
      if (filter === 'personal' && c.type !== 'personal') return false;
      if (filter === 'group' && c.type !== 'group') return false;
      if (filter === 'ai') return false;
      if (q && c.name.toLowerCase().indexOf(q) === -1 && c.preview.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    const filters = [
      { id: 'all', label: 'Все' },
      { id: 'personal', label: 'Личные' },
      { id: 'group', label: 'Группы' },
      { id: 'ai', label: 'Iris AI' },
    ];

    return (
      '<section class="screen is-active" data-name="chats">' +
        '<p class="eyebrow reveal">Messenger</p>' +
        '<h1 class="h2 reveal">Общайтесь с Iris и друзьями</h1>' +
        '<div class="search-bar reveal reveal-d1">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>' +
          '<input id="chat-search" type="search" placeholder="Поиск чатов" value="' + esc(state.chatSearch) + '" />' +
        '</div>' +
        '<div class="filter-row reveal reveal-d1">' +
          filters.map(function (f) {
            return '<button type="button" class="chip' + (filter === f.id ? ' is-active' : '') + '" data-filter="' + f.id + '">' + esc(f.label) + '</button>';
          }).join('') +
        '</div>' +
        '<button type="button" class="ai-promo reveal reveal-d2" data-open-chat="iris">' +
          '<span class="ai-promo__glow"></span>' +
          '<strong>✨ Iris AI</strong>' +
          '<p>Чем могу помочь?</p>' +
          '<span class="btn btn--white btn--sm">Написать Iris →</span>' +
        '</button>' +
        (filter === 'ai' ? '' : (
          '<div class="chat-list reveal reveal-d3">' +
            list.map(function (c) {
              return '<button type="button" class="chat-card" style="--accent:' + c.accent + '" data-open-chat="' + c.id + '">' +
                '<div class="' + avatarClass(c.color) + '">' + esc(c.avatar) + '</div>' +
                '<div class="chat-card__body"><div class="chat-card__top"><strong>' + esc(c.name) + '</strong><span class="chat-card__time">' + esc(c.time) + '</span></div>' +
                '<p class="chat-card__preview">' + esc(c.preview) + '</p></div>' +
                (c.unread ? '<span class="badge">' + c.unread + '</span>' : '') +
              '</button>';
            }).join('') +
          '</div>'
        )) +
        (filter === 'ai' ? '<div class="reveal reveal-d3" style="height:8px"></div>' : '') +
      '</section>'
    );
  }

  function ensureMessages(chatId) {
    if (state.messages[chatId]) return state.messages[chatId];
    if (chatId === 'iris') {
      state.messages[chatId] = [
        { from: 'iris', text: 'Привет! Я Iris 👋\nЧто сделаем сегодня?' },
      ];
    } else {
      const chat = CHATS.find(function (c) { return c.id === chatId; });
      state.messages[chatId] = [
        { from: 'iris', text: chat ? chat.preview : 'Привет!' },
        { from: 'user', text: 'Привет 👋' },
      ];
    }
    return state.messages[chatId];
  }

  function renderChatThread() {
    const chat = CHATS.find(function (c) { return c.id === state.chatId; }) || { name: 'Чат', avatar: '?', color: '' };
    const isAi = state.chatId === 'iris';
    const msgs = ensureMessages(state.chatId);

    return (
      '<section class="screen is-active" data-name="chat">' +
        '<div class="chat-thread">' +
          '<div class="chat-thread__head">' +
            '<button type="button" class="icon-btn" data-back aria-label="Назад"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18 9 12l6-6"/></svg></button>' +
            '<div class="' + avatarClass(chat.color) + ' avatar--sm">' + esc(chat.avatar) + '</div>' +
            '<div class="chat-thread__title"><strong>' + esc(chat.name) + '</strong><span>' + (isAi ? 'always online' : 'в сети') + '</span></div>' +
          '</div>' +
          '<div class="messages" id="msg-list">' +
            msgs.map(function (m) {
              if (m.from === 'user') {
                return '<div class="msg msg--user"><div class="msg__bubble">' + esc(m.text).replace(/\n/g, '<br/>') + '</div></div>';
              }
              return '<div class="msg msg--iris"><div class="' + avatarClass('ai') + ' avatar--sm">✨</div><div class="msg__bubble">' + esc(m.text).replace(/\n/g, '<br/>') + '</div></div>';
            }).join('') +
          '</div>' +
          (isAi ? (
            '<div class="ai-actions-row">' +
              AI_ACTIONS.slice(0, 4).map(function (a) {
                return '<button type="button" class="ai-action-chip" data-ai-prompt="' + esc(a.title) + '">' + a.icon + ' ' + esc(a.title) + '</button>';
              }).join('') +
            '</div>'
          ) : '') +
          '<div class="composer">' +
            '<div class="composer__tools">' +
              '<button type="button" class="composer__tool" data-tool="attach" aria-label="Вложение">＋</button>' +
              '<button type="button" class="composer__tool" data-tool="image" aria-label="Фото">🖼</button>' +
            '</div>' +
            '<input id="composer-input" type="text" placeholder="Напишите сообщение..." />' +
            '<button type="button" class="composer__tool" data-tool="voice" aria-label="Голос">🎙</button>' +
            '<button type="button" class="composer__send" data-send aria-label="Отправить">➤</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderAI() {
    return (
      '<section class="screen is-active" data-name="ai">' +
        '<div class="ai-hello reveal">' +
          '<p class="eyebrow">Iris AI</p>' +
          '<h1 class="h1">Привет! Я Iris 👋</h1>' +
          '<p class="lead">Что сделаем сегодня?</p>' +
        '</div>' +
        '<div class="ai-grid">' +
          AI_ACTIONS.map(function (a, i) {
            return '<button type="button" class="ai-tile ai-tile--' + a.tone + ' reveal reveal-d' + ((i % 4) + 1) + '" data-ai-start="' + a.id + '">' +
              '<div><div class="ai-tile__icon">' + a.icon + '</div><strong>' + esc(a.title) + '</strong><span>' + esc(a.sub) + '</span></div></button>';
          }).join('') +
        '</div>' +
        '<div class="section-gap reveal">' +
          '<button type="button" class="btn btn--white btn--wide" data-open-chat="iris">Открыть чат с Iris</button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderGames() {
    const featured = GAMES.find(function (g) { return g.featured; }) || GAMES[0];
    return (
      '<section class="screen is-active" data-name="games">' +
        '<p class="eyebrow reveal">Play</p>' +
        '<h1 class="h2 reveal">Играйте в Iris</h1>' +
        '<p class="lead reveal reveal-d1">Небольшие игры, чтобы развлечься и получить награды.</p>' +
        '<button type="button" class="hero-game reveal reveal-d2" data-play="' + featured.id + '">' +
          '<span class="hero-game__badge">🏆 DAILY CHALLENGE</span>' +
          '<h3>' + esc(featured.name) + '</h3>' +
          '<p>Сегодняшний челлендж — успей поставить рекорд</p>' +
          '<span class="btn btn--white btn--sm">Играть</span>' +
        '</button>' +
        '<div class="section-head"><h2>Выбирайте игру</h2></div>' +
        '<div class="games-grid">' +
          GAMES.map(function (g) {
            return '<button type="button" class="game-card" data-play="' + g.id + '">' +
              '<div class="game-card__art">' + g.emoji + '</div>' +
              '<div class="game-card__meta">' +
                '<strong>' + esc(g.name) + '</strong>' +
                '<p>' + esc(g.desc) + '</p>' +
                '<div class="game-card__stats">' +
                  '<span class="stat-pill">' + esc(g.difficulty) + '</span>' +
                  '<span class="stat-pill">Best ' + g.score + '</span>' +
                '</div>' +
                '<span class="btn btn--primary btn--sm">Play</span>' +
              '</div></button>';
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function renderProfile() {
    return (
      '<section class="screen is-active" data-name="profile">' +
        '<p class="eyebrow reveal">You</p>' +
        '<h1 class="h2 reveal">Профиль</h1>' +
        '<div class="profile-hero-card reveal reveal-d1">' +
          '<div class="avatar avatar--lg">' + esc(USER.avatar) + '</div>' +
          '<h2>' + esc(USER.name) + '</h2>' +
          '<span class="iris-id">Iris ID ' + esc(USER.irisId) + '</span>' +
          '<div class="profile-stats">' +
            '<div><strong>' + USER.stats.games + '</strong><small>Игры</small></div>' +
            '<div><strong>' + USER.stats.chats + '</strong><small>Чаты</small></div>' +
            '<div><strong>' + USER.stats.achievements + '</strong><small>Достижения</small></div>' +
          '</div>' +
        '</div>' +
        '<div class="profile-links reveal reveal-d2">' +
          [
            { icon: '🏆', title: 'Достижения', sub: '12 разблокировано' },
            { icon: '🎮', title: 'История игр', sub: 'Последние результаты' },
            { icon: '⭐', title: 'Избранное', sub: 'Чаты и игры' },
            { icon: '⚙️', title: 'Настройки', sub: 'Тема и уведомления' },
          ].map(function (item) {
            return '<button type="button" class="profile-link" data-profile-link="' + esc(item.title) + '">' +
              '<span class="profile-link__icon">' + item.icon + '</span>' +
              '<span><strong>' + esc(item.title) + '</strong><span>' + esc(item.sub) + '</span></span>' +
              '<span class="profile-link__chev">›</span></button>';
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  /* ========== Math Battle ========== */
  function startMathBattle() {
    state.overlay = 'play';
    state.game = {
      id: 'math',
      score: 0,
      time: 30,
      total: 30,
      question: null,
      over: false,
      timerId: null,
    };
    nextQuestion();
    route();
    state.game.timerId = setInterval(function () {
      if (!state.game || state.game.over) return;
      state.game.time -= 1;
      const bar = document.getElementById('timer-fill');
      const label = document.getElementById('timer-label');
      if (bar) bar.style.width = Math.max(0, (state.game.time / state.game.total) * 100) + '%';
      if (label) label.textContent = formatTime(state.game.time);
      if (state.game.time <= 0) endMathBattle();
    }, 1000);
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function nextQuestion() {
    const a = 2 + Math.floor(Math.random() * 12);
    const b = 2 + Math.floor(Math.random() * 12);
    const op = Math.random() > 0.45 ? '×' : '+';
    const answer = op === '×' ? a * b : a + b;
    const opts = new Set([answer]);
    while (opts.size < 4) {
      const delta = (Math.floor(Math.random() * 7) + 1) * (Math.random() > 0.5 ? 1 : -1);
      const v = Math.max(1, answer + delta * (op === '×' ? a : 1));
      opts.add(v);
    }
    const options = Array.from(opts).sort(function () { return Math.random() - 0.5; });
    state.game.question = { a: a, b: b, op: op, answer: answer, options: options };
  }

  function endMathBattle() {
    if (!state.game) return;
    state.game.over = true;
    if (state.game.timerId) clearInterval(state.game.timerId);
    haptic('success');
    route();
  }

  function renderMathBattle() {
    const g = state.game;
    if (!g) return '';

    if (g.over) {
      return (
        '<section class="screen is-active" data-name="play">' +
          '<div class="game-play">' +
            '<div class="result-card">' +
              '<div class="emoji">🎉</div>' +
              '<h2>Отлично!</h2>' +
              '<p>Ваш результат: <strong>' + g.score + '</strong></p>' +
              '<div class="result-actions">' +
                '<button type="button" class="btn btn--primary btn--wide" data-replay>Играть ещё</button>' +
                '<button type="button" class="btn btn--ghost btn--wide" data-back-games>В игры</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>'
      );
    }

    const q = g.question;
    return (
      '<section class="screen is-active" data-name="play">' +
        '<div class="game-play">' +
          '<div class="game-play__top">' +
            '<button type="button" class="icon-btn" data-back aria-label="Назад"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18 9 12l6-6"/></svg></button>' +
            '<h2>Math Battle</h2>' +
            '<span style="width:44px"></span>' +
          '</div>' +
          '<div class="score-big"><small>Score</small><strong id="score-value">' + g.score + '</strong></div>' +
          '<div>' +
            '<div class="timer-bar"><span id="timer-fill" style="width:' + ((g.time / g.total) * 100) + '%"></span></div>' +
            '<div class="timer-label" id="timer-label">' + formatTime(g.time) + '</div>' +
          '</div>' +
          '<div class="question-card">' +
            '<span>Решите пример</span>' +
            '<strong>' + q.a + ' ' + q.op + ' ' + q.b + ' = ?</strong>' +
          '</div>' +
          '<div class="answer-grid">' +
            q.options.map(function (opt) {
              return '<button type="button" class="answer-btn" data-answer="' + opt + '">' + opt + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function playGame(id) {
    haptic('medium');
    if (id === 'math' || id === 'daily') {
      if (state.game && state.game.timerId) clearInterval(state.game.timerId);
      startMathBattle();
      return;
    }
    const g = GAMES.find(function (x) { return x.id === id; });
    toast((g ? g.name : 'Игра') + ' скоро — пока доступен Math Battle');
  }

  /* ========== Bindings ========== */
  function bindCommon() {
    refs.host.querySelectorAll('[data-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        state.overlay = null;
        state.tab = el.dataset.go;
        route();
      });
    });

    refs.host.querySelectorAll('[data-open-chat]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('medium');
        state.chatId = el.dataset.openChat;
        state.overlay = 'chat';
        route();
      });
    });

    refs.host.querySelectorAll('[data-play]').forEach(function (el) {
      el.addEventListener('click', function () { playGame(el.dataset.play); });
    });

    refs.host.querySelectorAll('[data-back]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        if (state.overlay === 'play') {
          if (state.game && state.game.timerId) clearInterval(state.game.timerId);
          state.overlay = null;
          state.game = null;
          state.tab = 'games';
          route();
          return;
        }
        if (state.overlay === 'chat') {
          const wasIris = state.chatId === 'iris';
          state.overlay = null;
          state.chatId = null;
          state.tab = wasIris ? 'ai' : 'chats';
          route();
        }
      });
    });

    refs.host.querySelectorAll('[data-filter]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        state.chatFilter = el.dataset.filter;
        if (state.chatFilter === 'ai') {
          state.chatId = 'iris';
          state.overlay = 'chat';
        }
        route();
      });
    });

    const search = document.getElementById('chat-search');
    if (search) {
      search.addEventListener('input', function () {
        state.chatSearch = search.value;
      });
      search.addEventListener('change', function () { route(); });
    }

    refs.host.querySelectorAll('[data-ai-start]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('medium');
        state.chatId = 'iris';
        state.overlay = 'chat';
        const action = AI_ACTIONS.find(function (a) { return a.id === el.dataset.aiStart; });
        ensureMessages('iris');
        if (action) {
          state.messages.iris.push({ from: 'user', text: action.title });
          state.messages.iris.push({ from: 'iris', text: 'Отлично! Давай разберём «' + action.title + '». Напиши детали — я помогу.' });
        }
        route();
      });
    });

    refs.host.querySelectorAll('[data-ai-prompt]').forEach(function (el) {
      el.addEventListener('click', function () {
        sendChatMessage(el.dataset.aiPrompt);
      });
    });

    const sendBtn = refs.host.querySelector('[data-send]');
    const input = document.getElementById('composer-input');
    if (sendBtn && input) {
      const send = function () {
        const text = input.value.trim();
        if (!text) return;
        sendChatMessage(text);
        input.value = '';
      };
      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') send();
      });
    }

    refs.host.querySelectorAll('[data-tool]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        const map = { attach: 'Вложение', image: 'Изображение', voice: 'Голосовой ввод' };
        toast(map[el.dataset.tool] + ' — скоро');
      });
    });

    refs.host.querySelectorAll('[data-answer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!state.game || state.game.over) return;
        const val = Number(btn.dataset.answer);
        const correct = val === state.game.question.answer;
        btn.classList.add(correct ? 'is-correct' : 'is-wrong');
        haptic(correct ? 'success' : 'error');
        if (correct) {
          state.game.score += 40;
          const scoreEl = document.getElementById('score-value');
          if (scoreEl) {
            scoreEl.textContent = String(state.game.score);
            scoreEl.classList.add('is-pop');
            setTimeout(function () { scoreEl.classList.remove('is-pop'); }, 220);
          }
        }
        setTimeout(function () {
          if (!state.game || state.game.over) return;
          nextQuestion();
          route();
        }, 280);
      });
    });

    const replay = refs.host.querySelector('[data-replay]');
    if (replay) replay.addEventListener('click', function () { startMathBattle(); });

    const backGames = refs.host.querySelector('[data-back-games]');
    if (backGames) {
      backGames.addEventListener('click', function () {
        if (state.game && state.game.timerId) clearInterval(state.game.timerId);
        state.overlay = null;
        state.game = null;
        state.tab = 'games';
        route();
      });
    }

    refs.host.querySelectorAll('[data-profile-link]').forEach(function (el) {
      el.addEventListener('click', function () {
        haptic('light');
        toast(el.dataset.profileLink);
      });
    });
  }

  function sendChatMessage(text) {
    if (!state.chatId) return;
    haptic('light');
    const list = ensureMessages(state.chatId);
    list.push({ from: 'user', text: text });
    if (state.chatId === 'iris') {
      list.push({ from: 'iris', text: irisReply(text) });
    } else {
      list.push({ from: 'iris', text: 'Принято 👍' });
    }
    route();
    requestAnimationFrame(function () {
      const box = document.getElementById('msg-list');
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  function irisReply(text) {
    const t = text.toLowerCase();
    if (t.indexOf('игр') !== -1) return 'Могу открыть Games Hub. Попробуй Math Battle — сегодня Daily Challenge 🏆';
    if (t.indexOf('план') !== -1) return 'Давай составим план: 1) цель 2) шаги 3) дедлайн. Напиши цель.';
    if (t.indexOf('картин') !== -1 || t.indexOf('изображ') !== -1) return 'Опиши сцену — подскажу идею промпта для изображения.';
    return 'Поняла! Расскажи чуть подробнее — помогу быстрее.';
  }

  /* ========== Route ========== */
  function route() {
    document.body.dataset.screen = state.overlay || state.tab;
    setBackVisible(!!state.overlay);

    let html = '';
    if (state.overlay === 'chat') html = renderChatThread();
    else if (state.overlay === 'play') html = renderMathBattle();
    else if (state.tab === 'home') html = renderHome();
    else if (state.tab === 'chats') html = renderChats();
    else if (state.tab === 'ai') html = renderAI();
    else if (state.tab === 'games') html = renderGames();
    else if (state.tab === 'profile') html = renderProfile();
    else html = renderHome();

    refs.host.innerHTML = html;
    renderNav();
    bindCommon();

    if (state.overlay === 'chat') {
      setMainButton({ visible: false });
    } else if (state.tab === 'games' && !state.overlay) {
      setMainButton({
        visible: true,
        text: 'Играть',
        onClick: function () { playGame('math'); },
      });
    } else if (state.tab === 'ai' && !state.overlay) {
      setMainButton({
        visible: true,
        text: 'Спросить Iris',
        onClick: function () {
          state.chatId = 'iris';
          state.overlay = 'chat';
          route();
        },
      });
    } else {
      setMainButton({ visible: false });
    }
  }

  function hydrateUser() {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) {
      USER.name = name;
      USER.avatar = name.trim().charAt(0).toUpperCase() || 'И';
    }
  }

  function boot() {
    hydrateUser();
    initTelegram({
      onBack: function () {
        if (state.overlay) {
          if (state.game && state.game.timerId) clearInterval(state.game.timerId);
          state.overlay = null;
          state.game = null;
          route();
        }
      },
    });
    route();
    refs.root.classList.add('is-booted');
  }

  boot();
})();
