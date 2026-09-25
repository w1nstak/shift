import { haptic } from '../telegram.js';

function iconSvg(name) {
  const icons = {
    ladder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v18M16 3v18M8 8h8M8 13h8M8 18h8"/></svg>`,
    iris: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M3 12c2.5-5 6-7.5 9-7.5S18.5 7 21 12c-2.5 5-6 7.5-9 7.5S5.5 17 3 12Z"/></svg>`,
    reward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 14.5 9.5 21 10l-5 4.5L17.5 21 12 17.5 6.5 21 8 14.5 3 10l6.5-.5L12 3Z"/></svg>`,
    clan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 19 6v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z"/><path d="M9.5 12.2 11.2 14l3.4-3.6"/></svg>`,
  };
  return icons[name] || icons.reward;
}

export function createDeviceMockup(mockup, iris) {
  const el = document.createElement('div');
  el.className = 'device-mockup';
  el.setAttribute('aria-hidden', 'true');

  const messages = (mockup.messages || [])
    .map(
      (m) => `
      <div class="device-msg device-msg--${m.from}">
        <span>${escapeHtml(m.text)}</span>
      </div>`
    )
    .join('');

  const stats = (mockup.stats || [])
    .map(
      (s) => `
      <div class="device-stat">
        <small>${escapeHtml(s.label)}</small>
        <strong>${escapeHtml(s.value)}</strong>
      </div>`
    )
    .join('');

  el.innerHTML = `
    <div class="device-mockup__glow"></div>
    <div class="device-mockup__frame ${mockup.pulse ? 'is-pulsing' : ''}">
      <div class="device-mockup__bezel">
        <div class="device-mockup__notch"></div>
        <div class="device-mockup__screen">
          <header class="device-header">
            <div class="device-avatar">${escapeHtml(iris.avatarInitial || 'I')}</div>
            <div class="device-header__copy">
              <strong>${escapeHtml(mockup.title)}</strong>
              <span>${escapeHtml(mockup.subtitle)}</span>
            </div>
            <span class="device-live">Live</span>
          </header>
          <div class="device-chat">${messages}</div>
          <footer class="device-footer">${stats}</footer>
        </div>
      </div>
    </div>
  `;

  return el;
}

export function renderHero(root, { hero, mockup, iris }, { onAction } = {}) {
  if (!root) return;

  root.innerHTML = `
    <div class="hero__stage">
      <p class="hero__brand">${escapeHtml(hero.brand)}</p>
      <div class="hero__visual" data-slot="mockup"></div>
      <div class="hero__copy">
        <h1 class="hero__headline">${escapeHtml(hero.headline)}</h1>
        <p class="hero__desc">${escapeHtml(hero.description)}</p>
        <div class="hero__cta">
          <button type="button" class="btn btn--primary" data-action="${escapeAttr(hero.ctaPrimary.action)}">
            ${escapeHtml(hero.ctaPrimary.label)}
          </button>
          <button type="button" class="btn btn--ghost" data-action="${escapeAttr(hero.ctaSecondary.action)}">
            ${escapeHtml(hero.ctaSecondary.label)}
          </button>
        </div>
      </div>
    </div>
  `;

  const slot = root.querySelector('[data-slot="mockup"]');
  if (slot) slot.appendChild(createDeviceMockup(mockup, iris));

  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('medium');
      if (typeof onAction === 'function') onAction(btn.dataset.action);
    });
  });

  requestAnimationFrame(() => root.classList.add('is-ready'));
}

export function renderFeatureCarousel(root, features, { onSelect } = {}) {
  if (!root) return;

  root.innerHTML = `
    <div class="features__head">
      <h2 class="features__title">Что внутри</h2>
      <p class="features__sub">Коротко о мире Shift</p>
    </div>
    <div class="carousel" data-carousel>
      <div class="carousel__track" data-track>
        ${features
          .map(
            (f, i) => `
          <article class="feature-card feature-card--${f.accent} ${i === 0 ? 'is-active' : ''}" data-feature="${escapeAttr(f.id)}" tabindex="0">
            <div class="feature-card__icon">${iconSvg(f.icon)}</div>
            <h3>${escapeHtml(f.title)}</h3>
            <p>${escapeHtml(f.copy)}</p>
          </article>`
          )
          .join('')}
      </div>
      <div class="carousel__dots" data-dots>
        ${features.map((_, i) => `<button type="button" class="carousel__dot ${i === 0 ? 'is-active' : ''}" data-index="${i}" aria-label="Слайд ${i + 1}"></button>`).join('')}
      </div>
    </div>
  `;

  const track = root.querySelector('[data-track]');
  const dots = [...root.querySelectorAll('.carousel__dot')];
  const cards = [...root.querySelectorAll('.feature-card')];
  let index = 0;
  let autoTimer = null;

  const setIndex = (next, hapticOn = true) => {
    index = (next + cards.length) % cards.length;
    cards.forEach((card, i) => card.classList.toggle('is-active', i === index));
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    const active = cards[index];
    if (active && track) {
      const offset = active.offsetLeft - (track.clientWidth - active.clientWidth) / 2;
      track.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
    }
    if (hapticOn) haptic('light');
    if (typeof onSelect === 'function') onSelect(features[index]);
  };

  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      setIndex(Number(dot.dataset.index));
      restartAuto();
    });
  });

  cards.forEach((card, i) => {
    card.addEventListener('click', () => {
      setIndex(i);
      restartAuto();
    });
  });

  let startX = 0;
  track?.addEventListener(
    'touchstart',
    (e) => {
      startX = e.touches[0].clientX;
    },
    { passive: true }
  );
  track?.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) {
        setIndex(index + (dx < 0 ? 1 : -1));
        restartAuto();
      }
    },
    { passive: true }
  );

  function restartAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => setIndex(index + 1, false), 4200);
  }

  restartAuto();
  requestAnimationFrame(() => root.classList.add('is-ready'));
}

export function renderCTA(root, { hero, iris }, { onAction } = {}) {
  if (!root) return;

  root.innerHTML = `
    <div class="cta-band__inner">
      <div class="cta-band__copy">
        <p class="cta-band__brand">${escapeHtml(hero.brand)}</p>
        <h2>${escapeHtml(iris.name)} уже на смене</h2>
        <p>${escapeHtml(iris.tagline)}</p>
      </div>
      <button type="button" class="btn btn--primary btn--wide" data-action="${escapeAttr(hero.ctaPrimary.action)}">
        ${escapeHtml(hero.ctaPrimary.label)}
      </button>
    </div>
  `;

  root.querySelector('[data-action]')?.addEventListener('click', (e) => {
    haptic('medium');
    const action = e.currentTarget.dataset.action;
    if (typeof onAction === 'function') onAction(action);
  });

  requestAnimationFrame(() => root.classList.add('is-ready'));
}

export function renderBottomNav(root, items, activeId, { onNavigate } = {}) {
  if (!root) return;

  root.innerHTML = items
    .map(
      (item) => `
    <button type="button" class="bottom-nav__item ${item.id === activeId ? 'is-active' : ''}" data-target="${escapeAttr(item.id)}" aria-current="${item.id === activeId ? 'page' : 'false'}">
      <span class="bottom-nav__icon">${item.icon}</span>
      <small>${escapeHtml(item.label)}</small>
    </button>`
    )
    .join('');

  root.querySelectorAll('[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('light');
      if (typeof onNavigate === 'function') onNavigate(btn.dataset.target);
    });
  });
}

export function renderGames(root, games, { onPlay } = {}) {
  if (!root) return;

  root.innerHTML = games
    .map(
      (g) => `
    <article class="game-tile">
      <div class="game-tile__meta">
        <span class="game-tile__badge">${escapeHtml(g.badge)}</span>
        <h3>${escapeHtml(g.name)}</h3>
        <p>${escapeHtml(g.blurb)}</p>
      </div>
      <div class="game-tile__foot">
        <span>${g.bet ? `ставка ${g.bet}` : 'бесплатно'} · до +${g.maxReward}</span>
        <button type="button" class="btn btn--small" data-game="${escapeAttr(g.id)}">Играть</button>
      </div>
    </article>`
    )
    .join('');

  root.querySelectorAll('[data-game]').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('medium');
      if (typeof onPlay === 'function') onPlay(btn.dataset.game);
    });
  });
}

export function renderProfile(root, { player, iris, inventory }) {
  if (!root) return;

  const progress = player.xpNeed > 0 ? Math.min(100, (player.xp / player.xpNeed) * 100) : 0;

  root.innerHTML = `
    <section class="profile-card">
      <div class="profile-card__row">
        <div class="profile-avatar">${escapeHtml((player.displayName || 'И')[0].toUpperCase())}</div>
        <div>
          <p class="profile-rank">${escapeHtml(player.rank)}</p>
          <h3>${escapeHtml(player.displayName)}</h3>
          <p class="profile-tag">Уровень ${player.level} · Shift</p>
        </div>
      </div>
      <div class="profile-progress">
        <div class="profile-progress__meta">
          <span>Прогресс</span>
          <strong>${player.xp} / ${player.xpNeed}</strong>
        </div>
        <div class="profile-progress__bar"><span style="width:${progress}%"></span></div>
      </div>
      <div class="profile-stats">
        <div><small>Баланс</small><strong>${formatNum(player.balance)}</strong></div>
        <div><small>Победы</small><strong>${formatNum(player.wins)}</strong></div>
        <div><small>Стрик</small><strong>${player.streak}</strong></div>
      </div>
    </section>

    <section class="iris-card">
      <div class="iris-card__avatar">${escapeHtml(iris.avatarInitial)}</div>
      <div>
        <strong>${escapeHtml(iris.name)}</strong>
        <p>${escapeHtml(iris.role)} · ${escapeHtml(iris.status)}</p>
        <span>${escapeHtml(iris.tagline)}</span>
      </div>
    </section>

    <section class="inventory-mini">
      <div class="inventory-mini__head">
        <strong>Инвентарь</strong>
        <span>${inventory.length} предмета</span>
      </div>
      <div class="inventory-mini__grid">
        ${inventory
          .map(
            (item) => `
          <div class="inv-chip rarity-${item.rarity.toLowerCase()}">
            <strong>${escapeHtml(item.name)}</strong>
            <span>×${item.qty}</span>
          </div>`
          )
          .join('')}
      </div>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
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
