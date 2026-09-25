/* Shift Mini App — single bundle (no ES modules) for Telegram WebView */
(function () {
  'use strict';

  const IRIS_VERSION = '1.0.0-mock';

  const irisProfile = {
    id: 'iris-01',
    name: 'Iris',
    role: 'Гид Shift',
    tagline: 'Ведёт тебя через смены, награды и удачу.',
    avatarInitial: 'I',
    status: 'online',
    mood: 'focused',
  };

  const playerSeed = {
    id: 'player-local',
    displayName: 'Игрок',
    level: 6,
    xp: 420,
    xpNeed: 600,
    balance: 1250,
    wins: 84,
    streak: 3,
    vip: true,
    rank: 'Игрок',
  };

  const heroSeed = {
    brand: 'Shift',
    headline: 'Твоя смена начинается здесь',
    description: 'Мини-игры, награды и Iris — всё в одном премиальном пространстве Telegram.',
    ctaPrimary: { id: 'play', label: 'Начать смену', action: 'navigate:games' },
    ctaSecondary: { id: 'meet-iris', label: 'Познакомиться с Iris', action: 'navigate:profile' },
  };

  const mockupSeed = {
    title: 'Iris Live',
    subtitle: 'Активная смена',
    messages: [
      { from: 'iris', text: 'Смена открыта. Готова к первому раунду?' },
      { from: 'player', text: 'Поехали.' },
      { from: 'iris', text: 'Лесенка ждёт. Ставка 25 — потенциально ×16.' },
    ],
    stats: [
      { label: 'Баланс', value: '1 250' },
      { label: 'Стрик', value: '3 дня' },
    ],
    pulse: true,
  };

  const featuresSeed = [
    { id: 'ladder', title: 'Лесенка удачи', copy: 'Поднимайся по ступеням — каждая выше предыдущей.', accent: 'mint', icon: 'ladder' },
    { id: 'iris', title: 'Iris рядом', copy: 'Персональный гид подсказывает момент и держит ритм.', accent: 'amber', icon: 'iris' },
    { id: 'rewards', title: 'Живые награды', copy: 'Монеты, XP и редкие предметы за каждую удачную смену.', accent: 'coral', icon: 'reward' },
    { id: 'clan', title: 'Клан и события', copy: 'Новости, челленджи и общий прогресс в одном потоке.', accent: 'sky', icon: 'clan' },
  ];

  const gamesSeed = [
    { id: 'ladder', name: 'Лесенка', blurb: 'Рискни и поднимись выше', badge: 'Hot', bet: 25, maxReward: 420 },
    { id: 'roulette', name: 'Рулетка', blurb: 'Цвет или число — твой выбор', badge: 'Classic', bet: 25, maxReward: 900 },
    { id: 'daily', name: 'Ежедневный бонус', blurb: 'Забери награду за стрик', badge: 'Daily', bet: 0, maxReward: 500 },
  ];

  const inventorySeed = [
    { id: 'клевер', name: 'Клевер', rarity: 'Uncommon', qty: 2 },
    { id: 'удочка', name: 'Удочка', rarity: 'Rare', qty: 1 },
    { id: 'кирка', name: 'Кирка', rarity: 'Epic', qty: 1 },
  ];

  function getIrisData() {
    return {
      version: IRIS_VERSION,
      iris: Object.assign({}, irisProfile),
      player: Object.assign({}, playerSeed),
      hero: Object.assign({}, heroSeed),
      mockup: Object.assign({}, mockupSeed, {
        messages: mockupSeed.messages.map(function (m) { return Object.assign({}, m); }),
        stats: mockupSeed.stats.map(function (s) { return Object.assign({}, s); }),
      }),
      features: featuresSeed.map(function (f) { return Object.assign({}, f); }),
      games: gamesSeed.map(function (g) { return Object.assign({}, g); }),
      inventory: inventorySeed.map(function (i) { return Object.assign({}, i); }),
    };
  }

  function fetchIrisData() {
    return Promise.resolve(getIrisData());
  }

  /* ——— Telegram ——— */
  let tg = null;

  function getTelegram() {
    return tg || (window.Telegram && window.Telegram.WebApp) || null;
  }

  function isColorDark(hex) {
    if (!hex || typeof hex !== 'string') return true;
    const h = hex.replace('#', '');
    if (h.length !== 6) return true;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 140;
  }

  function applyThemeParams(webApp) {
    if (!webApp) return;
    const tp = webApp.themeParams || {};
    const root = document.documentElement;
    const map = {
      '--tg-bg': tp.bg_color,
      '--tg-text': tp.text_color,
      '--tg-hint': tp.hint_color,
      '--tg-link': tp.link_color,
      '--tg-button': tp.button_color,
      '--tg-button-text': tp.button_text_color,
      '--tg-secondary': tp.secondary_bg_color,
    };
    Object.keys(map).forEach(function (key) {
      if (map[key]) root.style.setProperty(key, map[key]);
    });
    const isDark = webApp.colorScheme === 'dark' || isColorDark(tp.bg_color);
    document.body.dataset.scheme = isDark ? 'dark' : 'light';
    const bg = tp.bg_color || (isDark ? '#0b0d10' : '#f4f1ec');
    try {
      if (typeof webApp.setHeaderColor === 'function') webApp.setHeaderColor(bg);
      if (typeof webApp.setBackgroundColor === 'function') webApp.setBackgroundColor(bg);
    } catch (e) { /* noop */ }
  }

  function haptic(style) {
    style = style || 'light';
    const feedback = tg && tg.HapticFeedback;
    if (!feedback) return;
    try {
      if (style === 'success' && feedback.notificationOccurred) {
        feedback.notificationOccurred('success');
        return;
      }
      if (feedback.impactOccurred) {
        const map = { light: 'light', medium: 'medium', heavy: 'heavy', soft: 'soft', rigid: 'rigid' };
        feedback.impactOccurred(map[style] || 'light');
      }
    } catch (e) { /* noop */ }
  }

  function setMainButtonVisible(visible, text) {
    if (!tg || !tg.MainButton) return;
    if (text) tg.MainButton.setText(text);
    if (visible) {
      tg.MainButton.show();
      tg.MainButton.enable();
    } else {
      tg.MainButton.hide();
    }
  }

  function initTelegram(opts) {
    opts = opts || {};
    tg = getTelegram();
    if (!tg) return null;
    tg.ready();
    tg.expand();
    applyThemeParams(tg);
    if (tg.MainButton) {
      tg.MainButton.setText('Начать смену');
      tg.MainButton.show();
      tg.MainButton.enable();
      tg.MainButton.onClick(function () {
        haptic('medium');
        if (typeof opts.onMainButton === 'function') opts.onMainButton();
      });
    }
    if (typeof tg.onEvent === 'function') {
      tg.onEvent('themeChanged', function () { applyThemeParams(tg); });
    }
    return tg;
  }

  /* ——— UI helpers ——— */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString('ru-RU');
  }

  function iconSvg(name) {
    const icons = {
      ladder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v18M16 3v18M8 8h8M8 13h8M8 18h8"/></svg>',
      iris: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M3 12c2.5-5 6-7.5 9-7.5S18.5 7 21 12c-2.5 5-6 7.5-9 7.5S5.5 17 3 12Z"/></svg>',
      reward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 14.5 9.5 21 10l-5 4.5L17.5 21 12 17.5 6.5 21 8 14.5 3 10l6.5-.5L12 3Z"/></svg>',
      clan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 19 6v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z"/><path d="M9.5 12.2 11.2 14l3.4-3.6"/></svg>',
    };
    return icons[name] || icons.reward;
  }

  function createDeviceMockup(mockup, iris) {
    const el = document.createElement('div');
    el.className = 'device-mockup';
    el.setAttribute('aria-hidden', 'true');
    const messages = (mockup.messages || []).map(function (m) {
      return '<div class="device-msg device-msg--' + m.from + '"><span>' + escapeHtml(m.text) + '</span></div>';
    }).join('');
    const stats = (mockup.stats || []).map(function (s) {
      return '<div class="device-stat"><small>' + escapeHtml(s.label) + '</small><strong>' + escapeHtml(s.value) + '</strong></div>';
    }).join('');
    el.innerHTML =
      '<div class="device-mockup__glow"></div>' +
      '<div class="device-mockup__frame ' + (mockup.pulse ? 'is-pulsing' : '') + '">' +
      '<div class="device-mockup__bezel"><div class="device-mockup__notch"></div>' +
      '<div class="device-mockup__screen">' +
      '<header class="device-header">' +
      '<div class="device-avatar">' + escapeHtml(iris.avatarInitial || 'I') + '</div>' +
      '<div class="device-header__copy"><strong>' + escapeHtml(mockup.title) + '</strong><span>' + escapeHtml(mockup.subtitle) + '</span></div>' +
      '<span class="device-live">Live</span></header>' +
      '<div class="device-chat">' + messages + '</div>' +
      '<footer class="device-footer">' + stats + '</footer>' +
      '</div></div></div>';
    return el;
  }

  function renderHero(root, payload, opts) {
    if (!root) return;
    const hero = payload.hero;
    root.innerHTML =
      '<div class="hero__stage">' +
      '<p class="hero__brand">' + escapeHtml(hero.brand) + '</p>' +
      '<div class="hero__visual" data-slot="mockup"></div>' +
      '<div class="hero__copy">' +
      '<h1 class="hero__headline">' + escapeHtml(hero.headline) + '</h1>' +
      '<p class="hero__desc">' + escapeHtml(hero.description) + '</p>' +
      '<div class="hero__cta">' +
      '<button type="button" class="btn btn--primary" data-action="' + escapeAttr(hero.ctaPrimary.action) + '">' + escapeHtml(hero.ctaPrimary.label) + '</button>' +
      '<button type="button" class="btn btn--ghost" data-action="' + escapeAttr(hero.ctaSecondary.action) + '">' + escapeHtml(hero.ctaSecondary.label) + '</button>' +
      '</div></div></div>';
    const slot = root.querySelector('[data-slot="mockup"]');
    if (slot) slot.appendChild(createDeviceMockup(payload.mockup, payload.iris));
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        haptic('medium');
        if (opts && typeof opts.onAction === 'function') opts.onAction(btn.dataset.action);
      });
    });
    requestAnimationFrame(function () { root.classList.add('is-ready'); });
  }

  function renderFeatureCarousel(root, features) {
    if (!root) return;
    root.innerHTML =
      '<div class="features__head"><h2 class="features__title">Что внутри</h2><p class="features__sub">Коротко о мире Shift</p></div>' +
      '<div class="carousel" data-carousel><div class="carousel__track" data-track>' +
      features.map(function (f, i) {
        return '<article class="feature-card feature-card--' + f.accent + (i === 0 ? ' is-active' : '') + '" data-feature="' + escapeAttr(f.id) + '" tabindex="0">' +
          '<div class="feature-card__icon">' + iconSvg(f.icon) + '</div>' +
          '<h3>' + escapeHtml(f.title) + '</h3><p>' + escapeHtml(f.copy) + '</p></article>';
      }).join('') +
      '</div><div class="carousel__dots" data-dots>' +
      features.map(function (_, i) {
        return '<button type="button" class="carousel__dot' + (i === 0 ? ' is-active' : '') + '" data-index="' + i + '" aria-label="Слайд ' + (i + 1) + '"></button>';
      }).join('') +
      '</div></div>';

    const track = root.querySelector('[data-track]');
    const dots = Array.prototype.slice.call(root.querySelectorAll('.carousel__dot'));
    const cards = Array.prototype.slice.call(root.querySelectorAll('.feature-card'));
    let index = 0;
    let autoTimer = null;

    function setIndex(next, hapticOn) {
      index = (next + cards.length) % cards.length;
      cards.forEach(function (card, i) { card.classList.toggle('is-active', i === index); });
      dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === index); });
      const active = cards[index];
      if (active && track) {
        const offset = active.offsetLeft - (track.clientWidth - active.clientWidth) / 2;
        track.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
      }
      if (hapticOn !== false) haptic('light');
    }

    function restartAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(function () { setIndex(index + 1, false); }, 4200);
    }

    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        setIndex(Number(dot.dataset.index));
        restartAuto();
      });
    });
    cards.forEach(function (card, i) {
      card.addEventListener('click', function () {
        setIndex(i);
        restartAuto();
      });
    });

    let startX = 0;
    if (track) {
      track.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
      track.addEventListener('touchend', function (e) {
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40) {
          setIndex(index + (dx < 0 ? 1 : -1));
          restartAuto();
        }
      }, { passive: true });
    }

    restartAuto();
    requestAnimationFrame(function () { root.classList.add('is-ready'); });
  }

  function renderCTA(root, payload, opts) {
    if (!root) return;
    root.innerHTML =
      '<div class="cta-band__inner"><div class="cta-band__copy">' +
      '<p class="cta-band__brand">' + escapeHtml(payload.hero.brand) + '</p>' +
      '<h2>' + escapeHtml(payload.iris.name) + ' уже на смене</h2>' +
      '<p>' + escapeHtml(payload.iris.tagline) + '</p></div>' +
      '<button type="button" class="btn btn--primary btn--wide" data-action="' + escapeAttr(payload.hero.ctaPrimary.action) + '">' +
      escapeHtml(payload.hero.ctaPrimary.label) + '</button></div>';
    const btn = root.querySelector('[data-action]');
    if (btn) {
      btn.addEventListener('click', function () {
        haptic('medium');
        if (opts && typeof opts.onAction === 'function') opts.onAction(btn.dataset.action);
      });
    }
    requestAnimationFrame(function () { root.classList.add('is-ready'); });
  }

  function renderBottomNav(root, items, activeId, opts) {
    if (!root) return;
    root.innerHTML = items.map(function (item) {
      return '<button type="button" class="bottom-nav__item' + (item.id === activeId ? ' is-active' : '') + '" data-target="' + escapeAttr(item.id) + '" aria-current="' + (item.id === activeId ? 'page' : 'false') + '">' +
        '<span class="bottom-nav__icon">' + item.icon + '</span><small>' + escapeHtml(item.label) + '</small></button>';
    }).join('');
    root.querySelectorAll('[data-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        haptic('light');
        if (opts && typeof opts.onNavigate === 'function') opts.onNavigate(btn.dataset.target);
      });
    });
  }

  function renderGames(root, games, opts) {
    if (!root) return;
    root.innerHTML = games.map(function (g) {
      return '<article class="game-tile"><div class="game-tile__meta">' +
        '<span class="game-tile__badge">' + escapeHtml(g.badge) + '</span>' +
        '<h3>' + escapeHtml(g.name) + '</h3><p>' + escapeHtml(g.blurb) + '</p></div>' +
        '<div class="game-tile__foot"><span>' + (g.bet ? ('ставка ' + g.bet) : 'бесплатно') + ' · до +' + g.maxReward + '</span>' +
        '<button type="button" class="btn btn--small" data-game="' + escapeAttr(g.id) + '">Играть</button></div></article>';
    }).join('');
    root.querySelectorAll('[data-game]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        haptic('medium');
        if (opts && typeof opts.onPlay === 'function') opts.onPlay(btn.dataset.game);
      });
    });
  }

  function renderProfile(root, payload) {
    if (!root) return;
    const player = payload.player;
    const iris = payload.iris;
    const inventory = payload.inventory;
    const progress = player.xpNeed > 0 ? Math.min(100, (player.xp / player.xpNeed) * 100) : 0;
    root.innerHTML =
      '<section class="profile-card"><div class="profile-card__row">' +
      '<div class="profile-avatar">' + escapeHtml((player.displayName || 'И').charAt(0).toUpperCase()) + '</div><div>' +
      '<p class="profile-rank">' + escapeHtml(player.rank) + '</p><h3>' + escapeHtml(player.displayName) + '</h3>' +
      '<p class="profile-tag">Уровень ' + player.level + ' · Shift</p></div></div>' +
      '<div class="profile-progress"><div class="profile-progress__meta"><span>Прогресс</span><strong>' + player.xp + ' / ' + player.xpNeed + '</strong></div>' +
      '<div class="profile-progress__bar"><span style="width:' + progress + '%"></span></div></div>' +
      '<div class="profile-stats"><div><small>Баланс</small><strong>' + formatNum(player.balance) + '</strong></div>' +
      '<div><small>Победы</small><strong>' + formatNum(player.wins) + '</strong></div>' +
      '<div><small>Стрик</small><strong>' + player.streak + '</strong></div></div></section>' +
      '<section class="iris-card"><div class="iris-card__avatar">' + escapeHtml(iris.avatarInitial) + '</div><div>' +
      '<strong>' + escapeHtml(iris.name) + '</strong><p>' + escapeHtml(iris.role) + ' · ' + escapeHtml(iris.status) + '</p>' +
      '<span>' + escapeHtml(iris.tagline) + '</span></div></section>' +
      '<section class="inventory-mini"><div class="inventory-mini__head"><strong>Инвентарь</strong><span>' + inventory.length + ' предмета</span></div>' +
      '<div class="inventory-mini__grid">' +
      inventory.map(function (item) {
        return '<div class="inv-chip rarity-' + item.rarity.toLowerCase() + '"><strong>' + escapeHtml(item.name) + '</strong><span>×' + item.qty + '</span></div>';
      }).join('') +
      '</div></section>';
  }

  /* ——— App ——— */
  const NAV_ITEMS = [
    { id: 'home', label: 'Главная', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5H14v-6H10v6H5.5A1.5 1.5 0 0 1 4 19v-8Z"/></svg>' },
    { id: 'games', label: 'Игры', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="7" width="12" height="10" rx="2.5"/><path d="M9 12h6M12 9v6M5 10.5 3.5 12 5 13.5M19 10.5 20.5 12 19 13.5"/></svg>' },
    { id: 'profile', label: 'Профиль', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.5"/><path d="M5 19c1.6-3 4.2-4.5 7-4.5s5.4 1.5 7 4.5"/></svg>' },
  ];

  const refs = {
    app: document.getElementById('app'),
    hero: document.getElementById('hero-root'),
    features: document.getElementById('features-root'),
    cta: document.getElementById('cta-root'),
    games: document.getElementById('games-root'),
    profile: document.getElementById('profile-root'),
    nav: document.getElementById('nav-root'),
    toastHost: document.getElementById('toast-host'),
    screens: Array.prototype.slice.call(document.querySelectorAll('.screen')),
  };

  let data = null;
  let activeScreen = 'home';

  function showToast(text) {
    if (!refs.toastHost) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    refs.toastHost.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-show'); });
    setTimeout(function () {
      el.classList.remove('is-show');
      setTimeout(function () { el.remove(); }, 280);
    }, 1400);
  }

  function switchScreen(id) {
    if (!NAV_ITEMS.some(function (n) { return n.id === id; })) return;
    activeScreen = id;
    refs.screens.forEach(function (screen) {
      const match = screen.dataset.screen === id;
      screen.classList.toggle('is-active', match);
      screen.hidden = !match;
    });
    renderBottomNav(refs.nav, NAV_ITEMS, activeScreen, { onNavigate: switchScreen });
    setMainButtonVisible(id === 'home' || id === 'games', id === 'games' ? 'Играть' : 'Начать смену');
  }

  function handleAction(action) {
    if (!action) return;
    if (action.indexOf('navigate:') === 0) {
      switchScreen(action.slice('navigate:'.length));
      return;
    }
    if (action === 'play') switchScreen('games');
  }

  function onPlayGame(gameId) {
    const game = data && data.games ? data.games.filter(function (g) { return g.id === gameId; })[0] : null;
    haptic('success');
    showToast(game ? ('Запускаем «' + game.name + '»') : 'Игра скоро');
  }

  function hydrateFromUrl(payload) {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) payload.player.displayName = name;
    function num(key, fallback) {
      const v = Number(params.get(key));
      return Number.isFinite(v) ? v : fallback;
    }
    payload.player.balance = num('balance', payload.player.balance);
    payload.player.level = num('level', payload.player.level);
    payload.player.xp = num('xp', payload.player.xp);
    payload.player.xpNeed = num('xp_need', payload.player.xpNeed);
    payload.player.wins = num('wins', payload.player.wins);
    payload.player.streak = num('streak', payload.player.streak);
    return payload;
  }

  function mount(payload) {
    data = payload;
    renderHero(refs.hero, payload, { onAction: handleAction });
    renderFeatureCarousel(refs.features, payload.features);
    renderCTA(refs.cta, payload, { onAction: handleAction });
    renderGames(refs.games, payload.games, { onPlay: onPlayGame });
    renderProfile(refs.profile, payload);
    renderBottomNav(refs.nav, NAV_ITEMS, activeScreen, { onNavigate: switchScreen });
    if (refs.app) refs.app.classList.add('is-booted');
  }

  function boot() {
    initTelegram({
      onMainButton: function () {
        if (activeScreen === 'home') switchScreen('games');
        else if (activeScreen === 'games' && data && data.games && data.games[0]) onPlayGame(data.games[0].id);
      },
    });
    fetchIrisData().then(function (payload) {
      mount(hydrateFromUrl(payload));
      switchScreen('home');
    }).catch(function (err) {
      console.error('Shift boot failed', err);
      showToast('Не удалось загрузить Shift');
    });
  }

  boot();
})();
