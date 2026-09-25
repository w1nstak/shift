/* Shift Fleets — clan ecosystem + auto clan chat sync */
(function (global) {
  'use strict';

  var state = {
    open: false,
    screen: 'home', // home | create | join | profile | missions
    fleet: null,
    form: { name: '', tag: '', description: '' },
    api: '',
    userId: 0,
    chatId: 0,
    name: 'Игрок',
  };

  var hooks = {
    haptic: function () {},
    toast: function () {},
    getTg: function () { return null; },
    onExit: function () {},
    onFleetChanged: function () {},
    apiFetch: null,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function api(path, opts) {
    if (hooks.apiFetch) return hooks.apiFetch(path, opts);
    throw new Error('NO_API');
  }

  function render() {
    var host = document.getElementById('fleets-host');
    if (!host || !state.open) return;
    var html = '';
    if (state.screen === 'create') html = renderCreate();
    else if (state.screen === 'join') html = renderJoin();
    else if (state.screen === 'profile' && state.fleet) html = renderProfile();
    else html = renderHome();
    host.innerHTML = html;
    bind();
  }

  function backSvg() {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="m14 6-6 6 6 6"/></svg>';
  }

  function renderHome() {
    if (!state.fleet) {
      return (
        '<div class="fl-screen">' +
          '<div class="fl-top"><button type="button" class="fl-back" data-fl-exit>' + backSvg() + '</button>' +
            '<div class="fl-brand"><small>SHIFT</small><strong>Fleets</strong></div><span></span></div>' +
          '<div class="fl-empty glass">' +
            '<div class="fl-empty__ico">⚓</div>' +
            '<h2>No Fleet</h2>' +
            '<p>Build your fleet. Clan chat appears automatically.</p>' +
            '<button type="button" class="btn btn--primary btn--wide" data-fl-go="create">CREATE FLEET</button>' +
            '<button type="button" class="btn btn--ghost btn--wide" data-fl-go="join">JOIN FLEET</button>' +
          '</div>' +
        '</div>'
      );
    }
    var f = state.fleet;
    return (
      '<div class="fl-screen">' +
        '<div class="fl-top"><button type="button" class="fl-back" data-fl-exit>' + backSvg() + '</button>' +
          '<div class="fl-brand"><small>SHIFT FLEETS</small><strong>' + esc(f.name) + '</strong></div><span></span></div>' +
        '<div class="fl-hero glass">' +
          '<div class="fl-badge">⚓</div>' +
          '<h1>[' + esc(f.tag) + '] ' + esc(f.name) + '</h1>' +
          '<p>Level ' + (f.level || 1) + ' · ' + (f.members_count || f.members || 0) + ' members</p>' +
          '<div class="fl-stats">' +
            '<div><strong>' + (f.wins || 0) + '</strong><small>Wins</small></div>' +
            '<div><strong>' + (f.losses || 0) + '</strong><small>Losses</small></div>' +
            '<div><strong>' + (f.win_rate || 0) + '%</strong><small>WR</small></div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn--primary btn--wide" data-fl-open-chat>OPEN CLAN CHAT</button>' +
        '<button type="button" class="btn btn--ghost btn--wide" data-fl-go="profile">FLEET PROFILE</button>' +
        '<button type="button" class="fl-danger" data-fl-leave>Leave Fleet</button>' +
      '</div>'
    );
  }

  function renderCreate() {
    return (
      '<div class="fl-screen">' +
        '<div class="fl-top"><button type="button" class="fl-back" data-fl-go="home">' + backSvg() + '</button>' +
          '<div class="fl-brand"><strong>Create Your Fleet</strong></div><span></span></div>' +
        '<label class="fl-label">Clan Name</label>' +
        '<input class="fl-input" id="fl-name" maxlength="32" placeholder="Blue Wave" value="' + esc(state.form.name) + '" />' +
        '<label class="fl-label">Tag</label>' +
        '<input class="fl-input" id="fl-tag" maxlength="5" placeholder="BW" value="' + esc(state.form.tag) + '" />' +
        '<label class="fl-label">Description</label>' +
        '<textarea class="fl-input fl-area" id="fl-desc" maxlength="200" placeholder="Our fleet rules the ocean">' + esc(state.form.description) + '</textarea>' +
        '<button type="button" class="btn btn--primary btn--wide" data-fl-create>CREATE FLEET</button>' +
      '</div>'
    );
  }

  function renderJoin() {
    return (
      '<div class="fl-screen">' +
        '<div class="fl-top"><button type="button" class="fl-back" data-fl-go="home">' + backSvg() + '</button>' +
          '<div class="fl-brand"><strong>Join Fleet</strong></div><span></span></div>' +
        '<label class="fl-label">Fleet Tag</label>' +
        '<input class="fl-input" id="fl-join-tag" maxlength="5" placeholder="BW" />' +
        '<button type="button" class="btn btn--primary btn--wide" data-fl-join>JOIN FLEET</button>' +
      '</div>'
    );
  }

  function renderProfile() {
    var f = state.fleet || {};
    var members = (f.members || []).map(function (m) {
      return '<div class="fl-member"><span class="fl-av">' + esc((m.name || '?')[0]) + '</span>' +
        '<span><strong>' + esc(m.name) + '</strong><small>' + esc(m.role) + '</small></span></div>';
    }).join('') || '<p class="fl-muted">No members</p>';
    var missions = (f.missions || []).map(function (m) {
      var pct = Math.min(100, Math.round((m.current / m.target) * 100));
      return '<div class="fl-mission"><strong>' + esc(m.title) + '</strong>' +
        '<div class="fl-bar"><i style="width:' + pct + '%"></i></div>' +
        '<small>' + m.current + ' / ' + m.target + '</small></div>';
    }).join('');
    return (
      '<div class="fl-screen">' +
        '<div class="fl-top"><button type="button" class="fl-back" data-fl-go="home">' + backSvg() + '</button>' +
          '<div class="fl-brand"><strong>Fleet Profile</strong></div><span></span></div>' +
        '<div class="fl-hero glass">' +
          '<h1>⚓ ' + esc(f.name) + '</h1>' +
          '<p>Tag: ' + esc(f.tag) + ' · Members: ' + (f.members_count || 0) + '/50</p>' +
          '<p>Clan Level: ' + (f.level || 1) + ' · XP: ' + Number(f.xp || 0).toLocaleString('ru-RU') + '</p>' +
        '</div>' +
        '<p class="fl-label">Members</p><div class="fl-list glass">' + members + '</div>' +
        '<p class="fl-label">Clan Missions</p><div class="fl-list glass">' + missions + '</div>' +
      '</div>'
    );
  }

  function bind() {
    var host = document.getElementById('fleets-host');
    if (!host) return;
    host.querySelectorAll('[data-fl-exit]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    host.querySelectorAll('[data-fl-go]').forEach(function (el) {
      el.addEventListener('click', function () {
        hooks.haptic('selection');
        state.screen = el.dataset.flGo;
        if (state.screen === 'profile') loadProfile();
        else render();
      });
    });
    var createBtn = host.querySelector('[data-fl-create]');
    if (createBtn) createBtn.addEventListener('click', doCreate);
    var joinBtn = host.querySelector('[data-fl-join]');
    if (joinBtn) joinBtn.addEventListener('click', doJoin);
    var leave = host.querySelector('[data-fl-leave]');
    if (leave) leave.addEventListener('click', doLeave);
    var openChat = host.querySelector('[data-fl-open-chat]');
    if (openChat) openChat.addEventListener('click', function () {
      close();
      if (hooks.onOpenFleetChat) hooks.onOpenFleetChat(state.fleet);
    });
  }

  async function doCreate() {
    var name = (document.getElementById('fl-name') || {}).value || '';
    var tag = (document.getElementById('fl-tag') || {}).value || '';
    var description = (document.getElementById('fl-desc') || {}).value || '';
    hooks.haptic('medium');
    try {
      var data = await api('/api/fleets/create', {
        method: 'POST',
        body: JSON.stringify({ name: name, tag: tag, description: description }),
      });
      state.fleet = data.fleet;
      state.screen = 'home';
      hooks.toast(data.message || 'Fleet Created');
      hooks.onFleetChanged(data.fleet_chat, data.fleet);
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function doJoin() {
    var tag = (document.getElementById('fl-join-tag') || {}).value || '';
    hooks.haptic('medium');
    try {
      var data = await api('/api/fleets/join', {
        method: 'POST',
        body: JSON.stringify({ tag: tag }),
      });
      state.fleet = data.fleet;
      state.screen = 'home';
      hooks.toast(data.message || 'Welcome to the Fleet');
      hooks.onFleetChanged(data.fleet_chat, data.fleet);
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function doLeave() {
    if (!confirm('Leave this fleet? Clan chat will disappear.')) return;
    try {
      await api('/api/fleets/leave', { method: 'POST', body: '{}' });
      state.fleet = null;
      hooks.toast('Left fleet');
      hooks.onFleetChanged(null, null);
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function loadProfile() {
    try {
      var data = await api('/api/fleets/me');
      state.fleet = data.fleet;
      state.screen = 'profile';
      render();
    } catch (e) {
      hooks.toast(e.message || 'Ошибка');
    }
  }

  async function refresh() {
    try {
      var data = await api('/api/fleets/me');
      state.fleet = data.fleet;
      if (data.fleet) hooks.onFleetChanged({
        clan_id: data.fleet.clan_id,
        name: data.fleet.name,
        tag: data.fleet.tag,
        members: data.fleet.members_count,
        level: data.fleet.level,
        preview: 'Fleet chat',
        chat_id: 'fleet-' + data.fleet.clan_id,
      }, data.fleet);
    } catch (e) {}
  }

  function open(opts) {
    opts = opts || {};
    Object.assign(hooks, opts.hooks || {});
    state.open = true;
    state.api = opts.api || '';
    state.userId = opts.userId || 0;
    state.chatId = opts.chatId || 0;
    state.name = opts.name || 'Игрок';
    state.fleet = opts.fleet || null;
    state.screen = 'home';
    var host = document.getElementById('fleets-host');
    if (host) {
      host.classList.add('is-open');
      host.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('fl-active');
    render();
    refresh();
  }

  function close() {
    state.open = false;
    var host = document.getElementById('fleets-host');
    if (host) {
      host.classList.remove('is-open');
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '';
    }
    document.body.classList.remove('fl-active');
    if (hooks.onExit) hooks.onExit();
  }

  function isOpen() { return state.open; }

  function handleBack() {
    if (!state.open) return false;
    if (state.screen !== 'home') {
      state.screen = 'home';
      render();
      return true;
    }
    close();
    return true;
  }

  global.ShiftFleets = { open: open, close: close, isOpen: isOpen, handleBack: handleBack, refresh: refresh };
})(window);
