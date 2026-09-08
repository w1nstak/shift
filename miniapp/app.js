const initialState = {
  balance: 1250,
  level: 6,
  xp: 420,
  xpNeed: 600,
  streak: 3,
  wins: 84,
  karma: 145,
  messages: 1240,
  shield: 2,
  vip: true,
  profileName: 'Игрок',
};

const state = loadState();

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const numeric = (key, fallback) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) ? value : fallback;
  };

  const name = params.get('name');
  if (name) state.profileName = name;
  state.balance = numeric('balance', state.balance);
  state.level = numeric('level', state.level);
  state.xp = numeric('xp', state.xp);
  state.xpNeed = numeric('xp_need', state.xpNeed);
  state.streak = numeric('streak', state.streak);
  state.wins = numeric('wins', state.wins);
  state.karma = numeric('karma', state.karma);
  state.messages = numeric('messages', state.messages);
  state.shield = numeric('shield', state.shield);
  state.vip = params.get('vip') === '1' || params.get('vip') === 'true' || state.vip;
}

hydrateFromUrl();

const refs = {
  balanceValue: document.getElementById('balanceValue'),
  streakValue: document.getElementById('streakValue'),
  levelValue: document.getElementById('levelValue'),
  xpValue: document.getElementById('xpValue'),
  winsValue: document.getElementById('winsValue'),
  vipValue: document.getElementById('vipValue'),
  profileName: document.getElementById('profileName'),
  profileTag: document.getElementById('profileTag'),
  profileCard: document.getElementById('profileCard'),
  karmaValue: document.getElementById('karmaValue'),
  messagesValue: document.getElementById('messagesValue'),
  shieldValue: document.getElementById('shieldValue'),
  navItems: [...document.querySelectorAll('.nav-item')],
  screens: [...document.querySelectorAll('.screen')],
  dailyBtn: document.getElementById('dailyBtn'),
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('shift-miniapp-state') || 'null');
    return { ...initialState, ...(saved || {}) };
  } catch {
    return { ...initialState };
  }
}

function saveState() {
  localStorage.setItem('shift-miniapp-state', JSON.stringify(state));
}

function formatNumber(value) {
  return Number(value).toLocaleString('ru-RU');
}

function render() {
  refs.balanceValue.textContent = formatNumber(state.balance);
  refs.streakValue.textContent = `${state.streak} ${state.streak % 10 === 1 && state.streak % 100 !== 11 ? 'день' : 'дня'}`;
  refs.levelValue.textContent = String(state.level);
  refs.xpValue.textContent = `${formatNumber(state.xp)} / ${formatNumber(state.xpNeed)}`;
  refs.winsValue.textContent = formatNumber(state.wins);
  refs.vipValue.textContent = state.vip ? 'Активен' : 'Неактивен';
  refs.profileName.textContent = state.profileName;
  refs.profileTag.textContent = `Уровень ${state.level} • Shift`;
  refs.profileCard.textContent = state.vip ? 'VIP' : 'Базовый';
  refs.karmaValue.textContent = `+${formatNumber(state.karma)}`;
  refs.messagesValue.textContent = formatNumber(state.messages);
  refs.shieldValue.textContent = String(state.shield);
  saveState();
}

function claimDailyBonus() {
  const base = 60 + (state.streak - 1) * 35;
  const bonus = Math.min(base + state.level * 10, 500);
  state.balance += bonus;
  state.streak += 1;
  state.xp += 25;
  if (state.xp >= state.xpNeed) {
    state.xp -= state.xpNeed;
    state.level += 1;
    state.xpNeed = Math.round(state.xpNeed * 1.25);
  }
  render();
  showToast(`+${formatNumber(bonus)} монет`);
}

function quickEarn(amount) {
  state.balance += amount;
  state.xp += 10;
  if (state.xp >= state.xpNeed) {
    state.xp -= state.xpNeed;
    state.level += 1;
    state.xpNeed = Math.round(state.xpNeed * 1.25);
  }
  render();
  showToast(`+${formatNumber(amount)} монет`);
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 1100);
}

function bindTabs() {
  refs.navItems.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.target;
      refs.navItems.forEach((item) => item.classList.toggle('active', item === button));
      refs.screens.forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
    });
  });
}

function bindActions() {
  refs.dailyBtn.addEventListener('click', claimDailyBonus);

  document.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => quickEarn(Number(button.dataset.quick)));
  });

  document.querySelectorAll('[data-game]').forEach((button) => {
    button.addEventListener('click', () => {
      const gameName = button.dataset.game;
      showToast(`Запускаем ${gameName}`);
    });
  });
}

function initTelegram() {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) {
    tg.setHeaderColor('#0f172a');
  }
  if (tg.setBackgroundColor) {
    tg.setBackgroundColor('#0f172a');
  }
  if (tg.MainButton) {
    tg.MainButton.setText('Играть');
    tg.MainButton.show();
    tg.MainButton.onClick(() => {
      claimDailyBonus();
      tg.HapticFeedback.impactOccurred('medium');
    });
  }
}

bindTabs();
bindActions();
initTelegram();
render();
