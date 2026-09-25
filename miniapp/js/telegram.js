/**
 * Telegram WebApp bridge — theme, MainButton, HapticFeedback, safe expand.
 */

let tg = null;

export function getTelegram() {
  return tg || (window.Telegram && window.Telegram.WebApp) || null;
}

export function initTelegram({ onMainButton } = {}) {
  tg = getTelegram();
  if (!tg) return null;

  tg.ready();
  tg.expand();

  applyThemeParams(tg);
  setupMainButton(onMainButton);

  if (typeof tg.onEvent === 'function') {
    tg.onEvent('themeChanged', () => applyThemeParams(tg));
  }

  return tg;
}

export function applyThemeParams(webApp = getTelegram()) {
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

  Object.entries(map).forEach(([key, value]) => {
    if (value) root.style.setProperty(key, value);
  });

  const isDark = webApp.colorScheme === 'dark' || isColorDark(tp.bg_color);
  document.body.dataset.scheme = isDark ? 'dark' : 'light';

  const header = isDark ? '#0b0d10' : '#f4f1ec';
  const bg = tp.bg_color || header;

  try {
    if (typeof webApp.setHeaderColor === 'function') webApp.setHeaderColor(bg);
    if (typeof webApp.setBackgroundColor === 'function') webApp.setBackgroundColor(bg);
  } catch {
    // Older clients may reject custom colors
  }
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

function setupMainButton(onMainButton) {
  if (!tg || !tg.MainButton) return;

  tg.MainButton.setText('Начать смену');
  tg.MainButton.show();
  tg.MainButton.enable();

  tg.MainButton.onClick(() => {
    haptic('medium');
    if (typeof onMainButton === 'function') onMainButton();
  });
}

export function setMainButtonVisible(visible, text) {
  if (!tg || !tg.MainButton) return;
  if (text) tg.MainButton.setText(text);
  if (visible) {
    tg.MainButton.show();
    tg.MainButton.enable();
  } else {
    tg.MainButton.hide();
  }
}

export function haptic(style = 'light') {
  const feedback = tg && tg.HapticFeedback;
  if (!feedback) return;

  try {
    if (style === 'success' && feedback.notificationOccurred) {
      feedback.notificationOccurred('success');
      return;
    }
    if (style === 'error' && feedback.notificationOccurred) {
      feedback.notificationOccurred('error');
      return;
    }
    if (style === 'warning' && feedback.notificationOccurred) {
      feedback.notificationOccurred('warning');
      return;
    }
    if (feedback.impactOccurred) {
      const map = { light: 'light', medium: 'medium', heavy: 'heavy', soft: 'soft', rigid: 'rigid' };
      feedback.impactOccurred(map[style] || 'light');
    }
  } catch {
    // no-op
  }
}

export function hapticSelection() {
  const feedback = tg && tg.HapticFeedback;
  if (feedback && feedback.selectionChanged) {
    try {
      feedback.selectionChanged();
    } catch {
      // no-op
    }
  }
}
