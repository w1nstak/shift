/* Shift — iOS-style Telegram Mini App */
(function () {
  'use strict';

  var STORE_KEY = 'shift-app-v3';

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
      if (tg.setHeaderColor) tg.setHeaderColor('#060B16');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#060B16');
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
      user: { name: 'Игрок', shiftId: '@player', avatar: 'И', photoUrl: '', coins: 0, userId: 0, chatId: 0, level: 1 },
      settings: { haptics: true, sounds: true },
      stats: { gamesPlayed: 0, bestMath: 0, bestTap: 0, streak: 1, messages: 0 },
      achievements: {},
      messages: {},
      chats: null,
      clan: null,
      api: '',
      fleetChat: null,
      challenges: [],
      profileEco: null,
      notifications: [],
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
        clan: parsed.clan || null,
        api: parsed.api || '',
        fleetChat: parsed.fleetChat || null,
        challenges: parsed.challenges || [],
        profileEco: parsed.profileEco || null,
        notifications: parsed.notifications || [],
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
  ];

  if (!store.chats) {
    store.chats = CHATS_SEED.map(function (c) { return Object.assign({}, c); });
  } else {
    store.chats = store.chats.filter(function (c) { return c.id === 'shift-ai'; });
    if (!store.chats.length) store.chats = CHATS_SEED.map(function (c) { return Object.assign({}, c); });
    saveStore();
  }

  var GAMES = [
    { id: 'sea', name: 'Shift Sea Battle', desc: 'Онлайн морской бой · S-Coins', icon: 'anchor', difficulty: 'Мультиплеер', featured: true },
    { id: 'math', name: 'Math Battle', desc: 'Считай быстрее всех', icon: 'brain', difficulty: 'Средняя' },
    { id: 'tap', name: 'Quick Tap', desc: 'Нажми цель как можно чаще', icon: 'target', difficulty: 'Лёгкая' },
    { id: 'daily', name: 'Daily Challenge', desc: 'Ежедневный Math Battle', icon: 'trophy', difficulty: 'Челлендж' },
  ];

  var AI_ACTIONS = [
    { id: 'create', title: 'Создать', sub: 'Идеи и черновики', icon: 'sparkles' },
    { id: 'search', title: 'Найти', sub: 'Ответы и факты', icon: 'search' },
    { id: 'write', title: 'Написать', sub: 'Тексты и посты', icon: 'pen' },
    { id: 'plan', title: 'Спланировать', sub: 'День и задачи', icon: 'flag' },
    { id: 'image', title: 'Создать изображение', sub: 'Визуальные идеи', icon: 'image' },
    { id: 'task', title: 'Выполнить', sub: 'Быстрые шаги', icon: 'bolt' },
  ];

  var ACHIEVEMENTS = [
    { id: 'first_game', title: 'Первая игра', sub: 'Сыграй любую игру', icon: 'gamepad' },
    { id: 'math_200', title: 'Считака', sub: 'Набери 200 в Math Battle', icon: 'brain' },
    { id: 'tap_40', title: 'Реактив', sub: '40 тапов в Quick Tap', icon: 'target' },
    { id: 'chatty', title: 'Собеседник', sub: '10 сообщений Shift', icon: 'chat' },
  ];

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10.5V19a1 1 0 0 0 1 1H10v-5h4v5h2.5a1 1 0 0 0 1-1v-8.5"/></svg>',
    games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="11" rx="3"/><path d="M8 12.5h3M9.5 11v3M15.2 11.2h.01M17.2 13.5h.01"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.8A2.8 2.8 0 0 1 7.8 4h8.4A2.8 2.8 0 0 1 19 6.8v5.4A2.8 2.8 0 0 1 16.2 15H10l-4.2 3.2V6.8Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-2.8 3.9-4.3 7-4.3s5.6 1.5 7 4.3"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4 12 3.5Z"/><path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7 18.5 15.5Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="m16.5 16.5 3 3"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 5.5 18.5 10.5"/><path d="M5 19.5 6.2 14.8 16.2 4.8a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L9.2 17.8 4.5 19Z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 5h9.5l-1.5 3.2 1.5 3.3H6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.5"/><path d="m7.5 17 3.2-3.5 2.3 2.2L16 12.5 19 17"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 6.5 13.5h5L11 21 17.5 10.5h-5L13 3Z"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 4.8a3 3 0 0 0-2.7 4.3A3.1 3.1 0 0 0 5 12.2c0 1.5.9 2.7 2.2 3.2V18a2 2 0 0 0 2 2h1.2"/><path d="M14.5 4.8a3 3 0 0 1 2.7 4.3A3.1 3.1 0 0 1 19 12.2c0 1.5-.9 2.7-2.2 3.2V18a2 2 0 0 1-2 2h-1.2"/><path d="M9.5 8.5v5M14.5 8.5v5M12 7v10"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4.5V2.8M12 21.2V19.5M4.5 12H2.8M21.2 12H19.5"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H5.2A2.2 2.2 0 0 0 3 8.2V9a3 3 0 0 0 3 3h1M17 6h1.8A2.2 2.2 0 0 1 21 8.2V9a3 3 0 0 1-3 3h-1"/></svg>',
    gamepad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="7" width="18" height="11" rx="3"/><path d="M8 12.5h3M9.5 11v3"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"/></svg>',
    clan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 18.5 6v5.2c0 4.1-2.6 7.8-6.5 9.6-3.9-1.8-6.5-5.5-6.5-9.6V6L12 3.2Z"/><path d="M9.4 12.1 11.2 14l3.5-3.8"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="2.8"/><path d="M3.8 18c.9-2.2 2.7-3.4 5.2-3.4s4.3 1.2 5.2 3.4"/><circle cx="16.5" cy="8.5" r="2.2"/><path d="M15.2 14.6c1.8.2 3.2 1.1 4 2.9"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="7.5"/><path d="M12 8v8M9.5 10.2c.5-1 1.4-1.5 2.5-1.5 1.5 0 2.5.8 2.5 2s-1 2-2.5 2.2c-1.5.2-2.5.9-2.5 2.1 0 1.1 1.1 1.9 2.6 1.9 1.2 0 2.1-.5 2.5-1.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12"/><path d="m12 6 6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m14 6-6 6 6 6"/></svg>',
    anchor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="2.2"/><path d="M12 8.2V20M8 12h8M7.2 16.5A6 6 0 0 0 12 20a6 6 0 0 0 4.8-3.5"/></svg>',
  };

  function icon(name, cls) {
    return '<span class="svg-icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + (ICONS[name] || ICONS.sparkles) + '</span>';
  }

  function iconBox(name, tone) {
    return '<span class="row__icon ' + (tone || 'bg-blue') + '">' + icon(name) + '</span>';
  }

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
    { id: 'home', label: 'Главная', iconKey: 'home' },
    { id: 'games', label: 'Игры', iconKey: 'games' },
    { id: 'chats', label: 'Чаты', iconKey: 'chat' },
    { id: 'profile', label: 'Профиль', iconKey: 'profile' },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function displayName(first, last) {
    return [first, last].filter(Boolean).join(' ').trim() || 'Игрок';
  }

  function initialsFrom(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'И';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  /** Telegram-synced avatar: photo or initials */
  function avatarHtml(user, cls) {
    var u = user || store.user;
    var letter = esc(u.avatar || initialsFrom(u.name) || '?');
    var clsName = cls || 'avatar';
    if (u.photoUrl) {
      return '<span class="' + clsName + ' ' + clsName + '--photo">' +
        '<img src="' + esc(u.photoUrl) + '" alt="" referrerpolicy="no-referrer" />' +
        '<span class="' + clsName + '__fallback" aria-hidden="true">' + letter + '</span></span>';
    }
    return '<span class="' + clsName + '">' + letter + '</span>';
  }

  function syncFromTelegram() {
    var tgApp = getTg();
    var u = tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user;
    if (!u) return false;
    var name = displayName(u.first_name, u.last_name);
    store.user.name = name;
    store.user.avatar = initialsFrom(name);
    store.user.photoUrl = u.photo_url || '';
    if (u.username) store.user.shiftId = '@' + u.username;
    else store.user.shiftId = '@' + name.toLowerCase().replace(/\s+/g, '').slice(0, 24);
    if (u.id) {
      store.user.userId = u.id;
      if (!store.user.chatId) store.user.chatId = u.id;
    }
    saveStore();
    return true;
  }

  function apiBase() {
    return (store.api || '').replace(/\/$/, '');
  }

  async function shiftApi(path, opts) {
    var base = apiBase();
    if (!base) throw new Error('API не подключён');
    var h = { 'Content-Type': 'application/json' };
    if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
    h['X-Shift-User'] = String(store.user.userId || 0);
    h['X-Shift-Chat'] = String(store.user.chatId || store.user.userId || 0);
    h['X-Shift-Name'] = store.user.name || 'Игрок';
    h['X-Shift-Level'] = String(store.user.level || 1);
    if (store.user.photoUrl) h['X-Shift-Photo'] = store.user.photoUrl;
    var res = await fetch(base + path, Object.assign({ headers: h }, opts || {}));
    var data = await res.json().catch(function () { return { ok: false, error: 'Bad response' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function applyFleetChat(fleetChat, fleet) {
    // remove old fleet chats
    store.chats = (store.chats || []).filter(function (c) { return c.type !== 'fleet'; });
    if (fleetChat) {
      store.chats.unshift({
        id: fleetChat.chat_id || ('fleet-' + fleetChat.clan_id),
        name: '⚓ ' + (fleetChat.name || 'Fleet'),
        preview: fleetChat.preview || 'Clan Chat',
        time: 'сейчас',
        unread: 0,
        type: 'fleet',
        clanId: fleetChat.clan_id,
        members: fleetChat.members,
        level: fleetChat.level,
        tag: fleetChat.tag,
      });
      if (fleet) {
        store.clan = {
          name: fleet.name,
          tag: fleet.tag,
          level: fleet.level || 1,
          coins: fleet.coins || 0,
          members: fleetChat.members || 0,
          xp: fleet.xp || 0,
          role: 'member',
          clan_id: fleet.clan_id,
        };
      }
      store.fleetChat = fleetChat;
    } else {
      store.fleetChat = null;
      // keep URL clan or clear mini-app fleet
      if (store.clan && store.clan.clan_id) store.clan = null;
    }
    saveStore();
    route();
  }

  async function syncEco() {
    if (!apiBase()) return;
    try {
      var data = await shiftApi('/api/shift/home');
      if (data.user) {
        store.user.coins = data.user.coins;
        if (data.user.name) store.user.name = data.user.name;
        if (data.user.photo_url) store.user.photoUrl = data.user.photo_url;
      }
      store.profileEco = data.profile || null;
      store.notifications = data.notifications || [];
      if (data.fleet_chat) applyFleetChat(data.fleet_chat, data.fleet);
      else if (!data.fleet) {
        store.chats = (store.chats || []).filter(function (c) { return c.type !== 'fleet'; });
        store.fleetChat = null;
      }
      if (data.fleet) {
        store.clan = {
          name: data.fleet.name,
          tag: data.fleet.tag,
          level: data.fleet.level || 1,
          coins: data.fleet.coins || 0,
          members: data.fleet_chat ? data.fleet_chat.members : 0,
          xp: data.fleet.xp || 0,
          role: 'member',
          clan_id: data.fleet.clan_id,
        };
      }
      saveStore();
      var ch = await shiftApi('/api/challenges');
      store.challenges = ch.challenges || [];
      saveStore();
      route();
    } catch (e) {}
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
        '<span class="shift-nav__icon">' + icon(item.iconKey) + '</span><small>' + esc(item.label) + '</small></button>';
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
  function renderClanCard() {
    var clan = store.clan;
    if (!clan || !clan.name) {
      return (
        '<p class="section-label">Shift Fleets</p>' +
        '<div class="clan-card clan-card--empty glass" data-open-fleets>' +
          '<div class="clan-card__top">' +
            '<div class="clan-badge">' + icon('clan') + '</div>' +
            '<div class="clan-card__copy">' +
              '<strong>Мой флот</strong>' +
              '<span>Пока без флота</span>' +
            '</div>' +
          '</div>' +
          '<p class="clan-card__hint">Создай флот — Clan Chat появится автоматически</p>' +
        '</div>'
      );
    }
    var role = clan.role === 'owner' ? 'Лидер' : clan.role === 'officer' ? 'Офицер' : 'Участник';
    return (
      '<p class="section-label">Shift Fleets</p>' +
      '<div class="clan-card glass" data-open-fleets>' +
        '<div class="clan-card__top">' +
          '<div class="clan-badge clan-badge--live">' + icon('clan') + '</div>' +
          '<div class="clan-card__copy">' +
            '<strong>Мой флот</strong>' +
            '<span class="clan-name">[' + esc(clan.tag) + '] ' + esc(clan.name) + '</span>' +
            '<small>' + esc(role) + ' · ур. ' + clan.level + '</small>' +
          '</div>' +
        '</div>' +
        '<div class="clan-stats">' +
          '<div><span class="clan-stats__icon">' + icon('users') + '</span><strong>' + clan.members + '</strong><small>игроки</small></div>' +
          '<div><span class="clan-stats__icon">' + icon('coin') + '</span><strong>' + Number(clan.coins || 0).toLocaleString('ru-RU') + '</strong><small>казна</small></div>' +
          '<div><span class="clan-stats__icon">' + icon('bolt') + '</span><strong>' + Number(clan.xp || 0).toLocaleString('ru-RU') + '</strong><small>XP</small></div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderHome() {
    return (
      '<section class="screen is-active">' +
        '<p class="greeting">' + greeting() + '</p>' +
        '<h1 class="large-title">' + esc(store.user.name) + '</h1>' +
        '<div class="stats-grid">' +
          '<div class="stat-card glass"><small>Лига</small><strong>' + esc((store.profileEco && store.profileEco.league) || 'Bronze') + '</strong><span>' + ((store.profileEco && store.profileEco.rating) || 1000) + ' MMR</span></div>' +
          '<div class="stat-card glass"><small>S-Coins</small><strong>' + Number(store.user.coins || 0).toLocaleString('ru-RU') + '</strong><span>баланс</span></div>' +
        '</div>' +

        renderClanCard() +

        '<p class="section-label">Ярлыки</p>' +
        '<div class="shortcuts">' +
          '<button type="button" class="shortcut" data-play="sea"><span class="shortcut__icon bg-teal">' + icon('anchor') + '</span><span>Sea</span></button>' +
          '<button type="button" class="shortcut" data-go="ai"><span class="shortcut__icon bg-blue">' + icon('sparkles') + '</span><span>Shift</span></button>' +
          '<button type="button" class="shortcut" data-play="math"><span class="shortcut__icon bg-orange">' + icon('brain') + '</span><span>Math</span></button>' +
          '<button type="button" class="shortcut" data-play="tap"><span class="shortcut__icon bg-pink">' + icon('target') + '</span><span>Tap</span></button>' +
        '</div>' +

        '<p class="section-label">Ассистент</p>' +
        '<div class="group glass">' +
          '<button type="button" class="row" data-open-chat="shift-ai">' +
            iconBox('sparkles', 'bg-teal') +
            '<span class="row__body"><span class="row__title">Shift AI</span><span class="row__sub">Спросить что угодно</span></span>' +
            icon('chevron', 'chevron-svg') + '</button>' +
        '</div>' +

        '<p class="section-label">Продолжить</p>' +
        '<div class="group glass">' +
          '<button type="button" class="row" data-play="daily">' +
            iconBox('trophy', 'bg-orange') +
            '<span class="row__body"><span class="row__title">Daily Challenge</span><span class="row__sub">Math Battle · сегодня</span></span>' +
            icon('chevron', 'chevron-svg') + '</button>' +
          '<button type="button" class="row" data-go="games">' +
            iconBox('gamepad', 'bg-purple') +
            '<span class="row__body"><span class="row__title">Shift Games</span><span class="row__sub">Сыграно: ' + store.stats.gamesPlayed + '</span></span>' +
            icon('chevron', 'chevron-svg') + '</button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderChats() {
    var fleetRows = (store.chats || []).filter(function (c) { return c.type === 'fleet'; }).map(function (c) {
      return '<button type="button" class="row fleet-chat-row" data-open-chat="' + esc(c.id) + '">' +
        iconBox('clan', 'bg-blue') +
        '<span class="row__body"><span class="row__title">' + esc(c.name) + '</span>' +
        '<span class="row__sub">' + (c.members || 0) + ' members · ' + esc(c.preview) + '</span></span>' +
        icon('chevron', 'chevron-svg') + '</button>';
    }).join('');

    var challenges = (store.challenges || []).filter(function (c) { return c.to_id === store.user.userId && c.status === 'pending'; }).map(function (c) {
      return '<div class="challenge-card">' +
        '<strong>⚓ SHIFT SEA BATTLE</strong>' +
        '<p>Challenge · Entry: ' + c.stake + ' S</p>' +
        '<div class="challenge-card__actions">' +
          '<button type="button" class="accept" data-challenge-accept="' + c.id + '">ACCEPT</button>' +
          '<button type="button" class="decline" data-challenge-decline="' + c.id + '">DECLINE</button>' +
        '</div></div>';
    }).join('');

    return (
      '<section class="screen is-active">' +
        '<h1 class="large-title">Чаты</h1>' +
        '<button type="button" class="banner glass" data-open-chat="shift-ai" style="margin-top:12px">' +
          '<span class="banner__icon">' + icon('sparkles') + '</span>' +
          '<span><strong>Shift AI</strong><span>Чем могу помочь?</span></span>' +
          icon('chevron', 'chevron-svg') +
        '</button>' +
        (challenges || '') +
        (fleetRows
          ? '<p class="section-label">Shift Fleets</p><div class="group glass">' + fleetRows + '</div>'
          : '<div class="group glass"><div class="empty-state">Нет флота.<br/>Создай Shift Fleet — Clan Chat появится здесь.</div></div>') +
        '<p class="section-label">Личные</p>' +
        '<div class="group glass">' +
          '<div class="empty-state">Личные диалоги появятся с друзьями.</div>' +
        '</div>' +
      '</section>'
    );
  }

  function ensureMessages(chatId) {
    if (store.messages[chatId] && store.messages[chatId].length) return store.messages[chatId];
    if (chatId === 'shift-ai') {
      store.messages[chatId] = [{ from: 'shift', text: 'Привет! Я Shift 👋\nЧто сделаем сегодня?' }];
    } else if (String(chatId).indexOf('fleet-') === 0) {
      store.messages[chatId] = [{ from: 'shift', text: '⚓ Fleet chat online.\nСообщения синхронизируются с сервером.' }];
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
    var isFleet = String(ui.chatId || '').indexOf('fleet-') === 0;
    var msgs = ensureMessages(ui.chatId);
    return (
      '<section class="screen is-active">' +
        '<div class="thread">' +
          '<div class="thread__bar glass-bar">' +
            '<button type="button" class="back" data-back aria-label="Назад">' + icon('back') + '</button>' +
            '<div class="thread__who"><strong>' + esc(chat.name) + '</strong><span>' +
              (isFleet ? ('Members: ' + (chat.members || 0) + ' · Lvl ' + (chat.level || 1)) : (isAi ? 'онлайн' : 'в сети')) +
            '</span></div>' +
            '<span></span>' +
          '</div>' +
          (isFleet ? '<div class="suggest"><button type="button" data-open-fleets>Clan Profile</button><button type="button" data-play="sea">Sea Battle</button></div>' : '') +
          '<div class="messages" id="msg-list">' +
            msgs.map(function (m) {
              var cls = m.from === 'user' ? 'bubble bubble--me' : 'bubble bubble--them';
              var prefix = m.name && m.from !== 'user' ? '<small style="opacity:.6">' + esc(m.name) + '</small><br/>' : '';
              return '<div class="' + cls + '">' + prefix + esc(m.text).replace(/\n/g, '<br/>') + '</div>';
            }).join('') +
            (ui.typing ? '<div class="typing">Shift печатает…</div>' : '') +
          '</div>' +
          (isAi ? (
            '<div class="suggest">' +
              AI_ACTIONS.slice(0, 4).map(function (a) {
                return '<button type="button" data-ai-prompt="' + esc(a.title) + '">' + icon(a.icon) + ' ' + esc(a.title) + '</button>';
              }).join('') +
            '</div>'
          ) : '') +
          '<div class="composer-bar glass-bar">' +
            '<button type="button" class="tool" data-attach aria-label="Вложение">' + icon('plus') + '</button>' +
            '<textarea id="composer-input" class="composer-field" rows="1" placeholder="Сообщение" enterkeyhint="send"></textarea>' +
            '<button type="button" class="composer-send" id="composer-send" data-send aria-label="Отправить">' + icon('send') + '</button>' +
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
        '<h1 class="large-title">Привет! Я Shift</h1>' +
        '<p class="subtitle">Что сделаем сегодня?</p>' +
        '<div class="ai-grid" style="margin-top:18px">' +
          AI_ACTIONS.map(function (a) {
            return '<button type="button" class="ai-tile glass" data-ai-start="' + a.id + '">' +
              '<div><div class="ai-tile__icon">' + icon(a.icon) + '</div><strong>' + esc(a.title) + '</strong><span>' + esc(a.sub) + '</span></div></button>';
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
        '<p class="subtitle">Мультиплеер и аркады · S-Coins</p>' +
        '<div style="margin-top:16px">' +
          '<button type="button" class="featured glass" data-play="sea">' +
            '<span class="tag">Online · S-Coins</span>' +
            '<h3>⚓ Shift Sea Battle</h3>' +
            '<p>Морской бой 1v1 · ставки и рейтинг</p>' +
          '<span class="btn btn--primary" style="min-height:36px;padding:0 14px;font-size:15px;border-radius:14px">Играть</span>' +
          '</button>' +
        '</div>' +
        '<p class="section-label">Все игры</p>' +
        '<div class="group glass">' +
          GAMES.map(function (g) {
            var best = g.id === 'tap' ? store.stats.bestTap : g.id === 'math' || g.id === 'daily' ? store.stats.bestMath : 'PvP';
            return '<button type="button" class="row" data-play="' + g.id + '">' +
              '<span class="game-art">' + icon(g.icon) + '</span>' +
              '<span class="row__body"><span class="row__title">' + esc(g.name) + '</span><span class="row__sub">' + esc(g.desc) + ' · ' + esc(g.difficulty) + '</span></span>' +
              '<span class="row__meta">' + best + '</span>' +
              icon('chevron', 'chevron-svg') + '</button>';
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function renderProfile() {
    return (
      '<section class="screen is-active">' +
        '<h1 class="large-title">Мой Shift</h1>' +
        '<div class="profile-card glass" style="margin-top:12px">' +
          avatarHtml(store.user, 'avatar-xl') +
          '<h2>' + esc(store.user.name) + '</h2>' +
          '<span class="id">' + esc(store.user.shiftId) + '</span>' +
          '<div class="p-stats">' +
            '<div><strong>' + store.stats.gamesPlayed + '</strong><small>Игры</small></div>' +
            '<div><strong>' + store.stats.messages + '</strong><small>Чаты</small></div>' +
            '<div><strong>' + countAchievements() + '</strong><small>Награды</small></div>' +
          '</div>' +
        '</div>' +
        (store.clan && store.clan.name ? (
          '<p class="section-label">Клан</p>' +
          '<div class="group glass">' +
            '<div class="row">' +
              iconBox('clan', 'bg-blue') +
              '<span class="row__body"><span class="row__title">[' + esc(store.clan.tag) + '] ' + esc(store.clan.name) + '</span>' +
              '<span class="row__sub">Ур. ' + store.clan.level + ' · ' + store.clan.members + ' участников</span></span></div>' +
          '</div>'
        ) : '') +
        '<p class="section-label">Аккаунт</p>' +
        '<div class="group glass">' +
          '<button type="button" class="row" data-sheet="achievements">' + iconBox('trophy', 'bg-orange') + '<span class="row__body"><span class="row__title">Достижения</span><span class="row__sub">' + countAchievements() + ' из ' + ACHIEVEMENTS.length + '</span></span>' + icon('chevron', 'chevron-svg') + '</button>' +
          '<button type="button" class="row" data-sheet="history">' + iconBox('gamepad', 'bg-purple') + '<span class="row__body"><span class="row__title">История игр</span><span class="row__sub">Math ' + store.stats.bestMath + ' · Tap ' + store.stats.bestTap + '</span></span>' + icon('chevron', 'chevron-svg') + '</button>' +
          '<button type="button" class="row" data-sheet="settings">' + iconBox('settings', 'bg-blue') + '<span class="row__body"><span class="row__title">Настройки</span><span class="row__sub">Хаптик и данные</span></span>' + icon('chevron', 'chevron-svg') + '</button>' +
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
          '<div class="result glass">' +
            '<div class="result__icon">' + icon('trophy') + '</div>' +
            '<h2>Отлично!</h2>' +
            '<p>Ваш результат: <strong>' + g.score + '</strong></p>' +
            '<div class="actions">' +
              '<button type="button" class="btn btn--blue btn--wide" data-replay>Играть ещё</button>' +
              '<button type="button" class="btn btn--ghost btn--wide" data-back-games>В игры</button>' +
            '</div>' +
          '</div>' +
        '</div></section>'
      );
    }

    if (g.kind === 'tap') {
      return (
        '<section class="screen is-active"><div class="play">' +
          '<div class="play__top"><button type="button" class="back" data-back aria-label="Назад">' + icon('back') + '</button><h1>Quick Tap</h1><span></span></div>' +
          '<div class="score-panel"><small>Тапы</small><strong id="score-value">' + g.score + '</strong></div>' +
          '<div class="progress"><i id="timer-fill" style="width:' + ((g.time / g.total) * 100) + '%"></i></div>' +
          '<div class="timer-text" id="timer-label">' + formatTime(g.time) + '</div>' +
          '<button type="button" class="tap-zone glass" id="tap-zone"><span class="tap-target"></span></button>' +
        '</div></section>'
      );
    }

    var q = g.question;
    return (
      '<section class="screen is-active"><div class="play">' +
        '<div class="play__top"><button type="button" class="back" data-back aria-label="Назад">' + icon('back') + '</button><h1>Math Battle</h1><span></span></div>' +
        '<div class="score-panel"><small>Счёт</small><strong id="score-value">' + g.score + '</strong></div>' +
        '<div class="progress"><i id="timer-fill" style="width:' + ((g.time / g.total) * 100) + '%"></i></div>' +
        '<div class="timer-text" id="timer-label">' + formatTime(g.time) + '</div>' +
        '<div class="q-card glass"><small>Решите пример</small><strong>' + q.a + ' ' + q.op + ' ' + q.b + ' = ?</strong></div>' +
        '<div class="answers">' +
          q.options.map(function (opt) {
            return '<button type="button" class="answer glass" data-answer="' + opt + '">' + opt + '</button>';
          }).join('') +
        '</div>' +
      '</div></section>'
    );
  }

  function playGame(id) {
    haptic('medium');
    if (id === 'sea') return openSeaBattle();
    if (id === 'math' || id === 'daily') return startMathBattle();
    if (id === 'tap') return startQuickTap();
    startMathBattle();
  }

  function openSeaBattle() {
    if (!window.ShiftSeaBattle) {
      toast('Sea Battle не загружен');
      return;
    }
    var params = new URLSearchParams(window.location.search);
    ShiftSeaBattle.open({
      coins: store.user.coins != null ? store.user.coins : Number(params.get('balance') || 0),
      userId: store.user.userId || Number(params.get('user_id') || 0),
      chatId: store.user.chatId || Number(params.get('chat_id') || params.get('user_id') || 0),
      name: store.user.name,
      photoUrl: store.user.photoUrl || '',
      avatar: store.user.avatar || '',
      level: store.user.level || Number(params.get('level') || 1),
      api: store.api || params.get('api') || '',
      profileEco: store.profileEco,
      hooks: {
        haptic: haptic,
        toast: toast,
        getTg: getTg,
        apiFetch: shiftApi,
        onOpenFleets: openFleets,
        onExit: function () {
          ui.overlay = null;
          ui.tab = 'games';
          syncEco();
          route();
        },
      },
    });
  }

  function openFleets() {
    if (!window.ShiftFleets) {
      toast('Fleets не загружен');
      return;
    }
    ShiftFleets.open({
      api: store.api,
      userId: store.user.userId,
      chatId: store.user.chatId,
      name: store.user.name,
      fleet: store.clan && store.clan.clan_id ? store.clan : null,
      hooks: {
        haptic: haptic,
        toast: toast,
        getTg: getTg,
        apiFetch: shiftApi,
        onFleetChanged: applyFleetChat,
        onOpenFleetChat: function (fleet) {
          var id = 'fleet-' + (fleet.clan_id || fleet.clanId);
          if (!(store.chats || []).some(function (c) { return c.id === id; })) {
            applyFleetChat({
              clan_id: fleet.clan_id,
              name: fleet.name,
              tag: fleet.tag,
              members: fleet.members_count || fleet.members || 0,
              level: fleet.level,
              preview: 'Clan Chat',
              chat_id: id,
            }, fleet);
          }
          ui.chatId = id;
          ui.overlay = 'chat';
          ui.tab = 'chats';
          route();
          loadFleetMessages(id);
        },
        onExit: function () {
          syncEco();
          route();
        },
      },
    });
  }

  async function respondChallenge(id, accept) {
    try {
      var data = await shiftApi('/api/challenges/respond', {
        method: 'POST',
        body: JSON.stringify({ id: id, accept: accept }),
      });
      if (accept && data.room) {
        toast('Battle ready');
        openSeaBattle();
      } else {
        toast(accept ? 'Accepted' : 'Declined');
      }
      syncEco();
    } catch (e) {
      toast(e.message || 'Ошибка');
    }
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
    list.push({ from: 'user', text: text, name: store.user.name });
    store.stats.messages += 1;
    if (store.stats.messages >= 10) unlock('chatty');
    updateChatPreview(ui.chatId, text);
    saveStore();
    haptic('light');

    if (String(ui.chatId).indexOf('fleet-') === 0) {
      shiftApi('/api/fleets/send', { method: 'POST', body: JSON.stringify({ text: text }) })
        .then(function () { return loadFleetMessages(ui.chatId); })
        .catch(function (e) { toast(e.message || 'Ошибка чата'); });
      route();
      scrollMessages();
      return;
    }

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

  async function loadFleetMessages(chatId) {
    if (!apiBase()) return;
    try {
      var data = await shiftApi('/api/fleets/messages');
      store.messages[chatId] = (data.messages || []).map(function (m) {
        return {
          from: m.user_id === store.user.userId ? 'user' : 'shift',
          text: m.text,
          name: m.name,
        };
      });
      if (!store.messages[chatId].length) {
        store.messages[chatId] = [{ from: 'shift', text: '⚓ Fleet chat ready.' }];
      }
      saveStore();
      if (ui.overlay === 'chat' && ui.chatId === chatId) {
        route();
        scrollMessages();
      }
    } catch (e) {}
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
              return '<div class="row" style="opacity:' + (on ? '1' : '0.55') + '">' + iconBox(a.icon, on ? 'bg-orange' : 'bg-blue') +
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
        var go = el.dataset.go;
        if (go === 'ai') {
          ui.chatId = 'shift-ai';
          ui.overlay = 'chat';
          route();
          return;
        }
        ui.overlay = null;
        ui.tab = go;
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
        if (String(ui.chatId).indexOf('fleet-') === 0) loadFleetMessages(ui.chatId);
      });
    });
    refs.host.querySelectorAll('[data-open-fleets]').forEach(function (el) {
      el.addEventListener('click', function () { openFleets(); });
    });
    refs.host.querySelectorAll('[data-challenge-accept]').forEach(function (el) {
      el.addEventListener('click', function () {
        respondChallenge(Number(el.dataset.challengeAccept), true);
      });
    });
    refs.host.querySelectorAll('[data-challenge-decline]').forEach(function (el) {
      el.addEventListener('click', function () {
        respondChallenge(Number(el.dataset.challengeDecline), false);
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
    if (window.ShiftFleets && ShiftFleets.isOpen && ShiftFleets.isOpen()) {
      if (ShiftFleets.handleBack()) return;
    }
    if (window.ShiftSeaBattle && ShiftSeaBattle.isOpen && ShiftSeaBattle.isOpen()) {
      if (ShiftSeaBattle.handleBack()) return;
    }
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
      ui.overlay = null;
      ui.chatId = null;
      ui.tab = 'chats';
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

    // 1) URL params from bot (fallback until Telegram initData)
    var name = params.get('name');
    if (name) {
      store.user.name = name;
      store.user.avatar = initialsFrom(name);
      store.user.shiftId = '@' + name.trim().toLowerCase().replace(/\s+/g, '');
    }
    var photo = params.get('photo');
    if (photo) store.user.photoUrl = photo;
    var username = params.get('username');
    if (username) store.user.shiftId = '@' + username.replace(/^@/, '');

    var balance = params.get('balance');
    if (balance != null && balance !== '') {
      var coins = parseInt(balance, 10);
      if (!isNaN(coins)) store.user.coins = coins;
    }
    var uid = params.get('user_id');
    if (uid) store.user.userId = parseInt(uid, 10) || 0;
    var cid = params.get('chat_id');
    if (cid) store.user.chatId = parseInt(cid, 10) || store.user.userId;
    var level = params.get('level');
    if (level) store.user.level = parseInt(level, 10) || 1;
    var api = params.get('api');
    if (api) store.api = api;
    var streak = params.get('streak');
    if (streak != null && streak !== '') {
      var n = parseInt(streak, 10);
      if (!isNaN(n) && n >= 0) store.stats.streak = n;
    }

    // 2) Telegram WebApp — source of truth for nick + avatar
    syncFromTelegram();
    saveStore();
  }

  function hydrateClanFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var name = params.get('clan_name');
    if (!name) return;
    store.clan = {
      name: name,
      tag: params.get('clan_tag') || 'CLAN',
      level: parseInt(params.get('clan_level') || '1', 10) || 1,
      coins: parseInt(params.get('clan_coins') || '0', 10) || 0,
      members: parseInt(params.get('clan_members') || '1', 10) || 1,
      xp: parseInt(params.get('clan_xp') || '0', 10) || 0,
      role: params.get('clan_role') || 'member',
    };
    saveStore();
  }

  function boot() {
    initTelegram({ onBack: goBack });
    hydrateUser();
    hydrateClanFromUrl();
    route();
    refs.root.classList.add('is-booted');
    syncEco();
  }

  boot();
})();
