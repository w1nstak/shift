/**
 * Mock data for Iris — swap this module for API responses later.
 * All UI reads through getIrisData() so backend wiring stays localized.
 */

export const IRIS_VERSION = '1.0.0-mock';

const irisProfile = {
  id: 'iris-01',
  name: 'Iris',
  role: 'Гид Shift',
  tagline: 'Ведёт тебя через смены, награды и удачу.',
  avatarInitial: 'I',
  status: 'online',
  mood: 'focused',
};

const player = {
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

const hero = {
  brand: 'Shift',
  headline: 'Твоя смена начинается здесь',
  description: 'Мини-игры, награды и Iris — всё в одном премиальном пространстве Telegram.',
  ctaPrimary: { id: 'play', label: 'Начать смену', action: 'navigate:games' },
  ctaSecondary: { id: 'meet-iris', label: 'Познакомиться с Iris', action: 'navigate:profile' },
};

const mockup = {
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

const features = [
  {
    id: 'ladder',
    title: 'Лесенка удачи',
    copy: 'Поднимайся по ступеням — каждая выше предыдущей.',
    accent: 'mint',
    icon: 'ladder',
  },
  {
    id: 'iris',
    title: 'Iris рядом',
    copy: 'Персональный гид подсказывает момент и держит ритм.',
    accent: 'amber',
    icon: 'iris',
  },
  {
    id: 'rewards',
    title: 'Живые награды',
    copy: 'Монеты, XP и редкие предметы за каждую удачную смену.',
    accent: 'coral',
    icon: 'reward',
  },
  {
    id: 'clan',
    title: 'Клан и события',
    copy: 'Новости, челленджи и общий прогресс в одном потоке.',
    accent: 'sky',
    icon: 'clan',
  },
];

const games = [
  {
    id: 'ladder',
    name: 'Лесенка',
    blurb: 'Рискни и поднимись выше',
    badge: 'Hot',
    bet: 25,
    maxReward: 420,
  },
  {
    id: 'roulette',
    name: 'Рулетка',
    blurb: 'Цвет или число — твой выбор',
    badge: 'Classic',
    bet: 25,
    maxReward: 900,
  },
  {
    id: 'daily',
    name: 'Ежедневный бонус',
    blurb: 'Забери награду за стрик',
    badge: 'Daily',
    bet: 0,
    maxReward: 500,
  },
];

const inventoryPreview = [
  { id: 'клевер', name: 'Клевер', rarity: 'Uncommon', qty: 2 },
  { id: 'удочка', name: 'Удочка', rarity: 'Rare', qty: 1 },
  { id: 'кирка', name: 'Кирка', rarity: 'Epic', qty: 1 },
];

const notifications = [
  {
    id: 'n1',
    title: 'Смена открыта',
    message: 'Iris ждёт тебя на арене.',
    time: 'сейчас',
    read: false,
  },
  {
    id: 'n2',
    title: 'Стрик ×3',
    message: 'Забери ежедневный бонус, пока он активен.',
    time: '1 ч',
    read: false,
  },
];

/** Single source of truth for the frontend (mock). */
export function getIrisData() {
  return {
    version: IRIS_VERSION,
    iris: irisProfile,
    player: { ...player },
    hero: { ...hero },
    mockup: {
      ...mockup,
      messages: mockup.messages.map((m) => ({ ...m })),
      stats: mockup.stats.map((s) => ({ ...s })),
    },
    features: features.map((f) => ({ ...f })),
    games: games.map((g) => ({ ...g })),
    inventory: inventoryPreview.map((i) => ({ ...i })),
    notifications: notifications.map((n) => ({ ...n })),
  };
}

/**
 * Placeholder for future API.
 * @returns {Promise<ReturnType<typeof getIrisData>>}
 */
export async function fetchIrisData() {
  // Later: return await api.get('/iris/me')
  return getIrisData();
}
