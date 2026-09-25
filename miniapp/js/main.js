import { fetchIrisData } from './data/iris.js';
import { initTelegram, setMainButtonVisible, haptic } from './telegram.js';
import {
  renderHero,
  renderFeatureCarousel,
  renderCTA,
  renderBottomNav,
  renderGames,
  renderProfile,
} from './components/ui.js';

const NAV_ITEMS = [
  {
    id: 'home',
    label: 'Главная',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5H14v-6H10v6H5.5A1.5 1.5 0 0 1 4 19v-8Z"/></svg>`,
  },
  {
    id: 'games',
    label: 'Игры',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="7" width="12" height="10" rx="2.5"/><path d="M9 12h6M12 9v6M5 10.5 3.5 12 5 13.5M19 10.5 20.5 12 19 13.5"/></svg>`,
  },
  {
    id: 'profile',
    label: 'Профиль',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.5"/><path d="M5 19c1.6-3 4.2-4.5 7-4.5s5.4 1.5 7 4.5"/></svg>`,
  },
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
  screens: [...document.querySelectorAll('.screen')],
};

let data = null;
let activeScreen = 'home';

function handleAction(action) {
  if (!action) return;
  if (action.startsWith('navigate:')) {
    switchScreen(action.slice('navigate:'.length));
    return;
  }
  if (action === 'play') {
    switchScreen('games');
  }
}

function switchScreen(id) {
  if (!NAV_ITEMS.some((n) => n.id === id)) return;
  activeScreen = id;

  refs.screens.forEach((screen) => {
    const match = screen.dataset.screen === id;
    screen.classList.toggle('is-active', match);
    screen.hidden = !match;
  });

  renderBottomNav(refs.nav, NAV_ITEMS, activeScreen, { onNavigate: switchScreen });
  setMainButtonVisible(id === 'home' || id === 'games', id === 'games' ? 'Играть' : 'Начать смену');

  if (id === 'home') {
    refs.screens.find((s) => s.dataset.screen === 'home')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function showToast(text) {
  if (!refs.toastHost) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  refs.toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-show'));
  setTimeout(() => {
    el.classList.remove('is-show');
    setTimeout(() => el.remove(), 280);
  }, 1400);
}

function onPlayGame(gameId) {
  const game = data?.games?.find((g) => g.id === gameId);
  haptic('success');
  showToast(game ? `Запускаем «${game.name}»` : 'Игра скоро');
}

function hydrateFromUrl(payload) {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name');
  if (name) payload.player.displayName = name;

  const num = (key, fallback) => {
    const v = Number(params.get(key));
    return Number.isFinite(v) ? v : fallback;
  };

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

  refs.app?.classList.add('is-booted');
}

async function boot() {
  initTelegram({
    onMainButton: () => {
      if (activeScreen === 'home') switchScreen('games');
      else if (activeScreen === 'games') {
        const first = data?.games?.[0];
        if (first) onPlayGame(first.id);
      }
    },
  });

  const payload = hydrateFromUrl(await fetchIrisData());
  mount(payload);
  switchScreen('home');
}

boot().catch((err) => {
  console.error('Shift boot failed', err);
  showToast('Не удалось загрузить Shift');
});
