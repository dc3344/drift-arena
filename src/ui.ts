import './styles.css';

export interface GameSettings {
  sensitivity: number;
  fov: number;
  volume: number;
  quality: 'low' | 'high';
}

export interface ScoreboardPlayer {
  id?: string;
  name: string;
  kills: number;
  deaths: number;
  isLocal?: boolean;
  ping?: number;
}

export interface KillFeedEntry {
  killer: string;
  victim: string;
  isLocal?: boolean;
}

export interface HudData {
  health: number;
  ammo: number;
  maxAmmo: number;
  speed: number;
  time: number;
  score: number;
  kills: number;
  deaths: number;
  reloading?: boolean;
  leaderboard?: ScoreboardPlayer[];
  killFeed?: KillFeedEntry[];
  ping?: number;
  onlineCount?: number;
  respawnIn?: number;
}

export interface UICallbacks {
  onDeploy: (name: string, roomCode: string) => void | Promise<void>;
  onResume: () => void;
  onPause?: () => void;
  onLeave: () => void;
  onSettingsChange: (settings: GameSettings) => void;
  onCopyInvite?: (roomCode: string) => void | Promise<void>;
}

export type UIMode = 'lobby' | 'playing' | 'paused';

const icon = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M15 8V4H4v12h4" stroke="currentColor" stroke-width="1.5"/></svg>',
  friends: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2" stroke="currentColor" stroke-width="1.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.5"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 9 4-.01L13 5v14l-5-4H4V9ZM17 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
};

const defaults: GameSettings = { sensitivity: 1, fov: 100, volume: 60, quality: 'high' };
const escapeHTML = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function setupUI(callbacks: UICallbacks) {
  const app = document.querySelector<HTMLElement>('#app')!;
  let mode: UIMode = 'lobby';
  let modal: 'controls' | 'settings' | null = null;
  let settings: GameSettings = { ...defaults };
  let savedName = 'WANDERER';
  try {
    settings = { ...defaults, ...JSON.parse(localStorage.getItem('drift-settings') || '{}') };
    savedName = localStorage.getItem('drift-name') || savedName;
  } catch { /* Preferences are optional when storage is unavailable. */ }
  settings.sensitivity = Math.min(2.5, Math.max(0.2, Number(settings.sensitivity) || 1));
  settings.fov = Math.min(120, Math.max(75, Number(settings.fov) || 100));
  settings.volume = Math.min(100, Math.max(0, Number(settings.volume) || 0));
  settings.quality = settings.quality === 'low' ? 'low' : 'high';

  app.insertAdjacentHTML('beforeend', `
    <div class="scene-vignette" aria-hidden="true"></div>
    <div id="lobby" class="lobby">
      <header class="site-header">
        <a class="brand" href="#" aria-label="DRIFT Arena home"><span class="brand-word">DRIFT<span class="brand-notch">/</span></span><span class="brand-sub">ARENA</span></a>
        <nav class="main-nav" aria-label="Main navigation">
          <button class="nav-link is-active" data-nav="play">PLAY<span>01</span></button>
          <button class="nav-link" data-nav="controls">HOW TO PLAY<span>02</span></button>
          <button class="nav-link" data-nav="settings">SETTINGS<span>03</span></button>
        </nav>
        <div class="server-status"><span class="status-light"></span><span id="server-status-text">CONNECTING</span><span class="status-divider"></span><span id="platform-label">BROWSER BUILD</span></div>
      </header>

      <main class="lobby-main">
        <section class="hero" aria-label="Play DRIFT Arena">
          <div class="eyebrow"><span class="eyebrow-line"></span> BROWSER-BASED MAYHEM</div>
          <h1 id="hero-title">MOVE FAST.<br>HIT HARD<span class="accent">.</span></h1>
          <p class="hero-copy" id="hero-copy">No downloads. No waiting around.<br>Just you, your reflexes, and everyone in your way.</p>
          <form id="deploy-form" class="deploy-form">
            <label class="field-label" for="player-name">YOUR CALLSIGN <span>MAKE IT COUNT.</span></label>
            <div class="callsign-field"><span class="input-bracket">[</span><input id="player-name" name="player-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="ENTER CALLSIGN" value="${escapeHTML(savedName)}" aria-label="Your callsign"><span class="input-bracket">]</span><span class="input-status">READY</span></div>
            <button id="deploy-button" class="deploy-button" type="submit"><span id="deploy-label">DEPLOY</span><span class="deploy-detail" id="deploy-detail">ENTER THE ARENA</span>${icon.arrow}</button>
          </form>
          <div class="friends-area" id="friends-area">
            <button class="friends-button" id="friends-button" aria-expanded="false" aria-controls="room-form">${icon.friends}<span>PLAY WITH FRIENDS</span><span class="small-plus">+</span></button>
            <div class="room-form" id="room-form" hidden><label for="room-code">ROOM CODE</label><div class="room-input-wrap"><input id="room-code" name="room-code" maxlength="24" autocomplete="off" spellcheck="false" placeholder="PUBLIC"><button type="button" id="copy-invite" title="Copy invite link" aria-label="Copy room invite link">${icon.copy}</button></div><p>Use the same code to drop into the same arena.</p></div>
          </div>
          <button id="leave-match" class="leave-match" hidden>LEAVE MATCH ${icon.arrow}</button>
          <div class="hero-footnote"><span class="tiny-cross">+</span> EASY TO ENTER. HARD TO PUT DOWN.</div>
        </section>

        <aside class="arena-preview" aria-label="Arena information">
          <div class="preview-topline"><span class="preview-live"><i></i> LIVE ARENA PREVIEW</span><span>34° 07′ N &nbsp; 118° 19′ W</span></div>
          <div class="preview-center-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          <div class="map-card">
            <div class="map-card-top"><span class="map-number">01 <i>/</i></span><span class="map-tag">CURRENT MAP</span><span class="map-shape" aria-hidden="true">⌁</span></div>
            <div class="map-title">THE FOUNDRY</div>
            <div class="map-description">Clock in. Lock on. Cause a little chaos.</div>
            <div class="map-card-rule"></div>
            <div class="map-meta"><div><span class="meta-label">GAME MODE</span><span>FREE-FOR-ALL</span></div><div><span class="meta-label">CAPACITY</span><span>8 PLAYERS</span></div><div><span class="meta-label">ROUND</span><span>05:00</span></div><span class="map-direction" aria-hidden="true">↗</span></div>
          </div>
        </aside>
      </main>

      <footer class="lobby-footer">
        <div class="quick-controls" aria-label="Quick controls"><span class="control-caption">BUILT FOR<br><b>MOVEMENT.</b></span><span class="control-item"><kbd>W A S D</kbd><span>MOVE</span></span><span class="control-item"><kbd>SPACE</kbd><span>JUMP</span></span><span class="control-item"><kbd>SHIFT</kbd><span>SLIDE</span></span><span class="control-item"><span class="mouse-key" aria-hidden="true"></span><span>AIM / FIRE</span></span></div>
        <div class="version"><span class="version-square"></span> V.0.1.0 <span class="version-slash">/</span> EARLY ACCESS</div>
      </footer>
    </div>

    <div id="hud" class="hud" hidden>
      <div class="hud-roster"><div class="hud-micro">DRIFT <span>/</span> ARENA</div><div id="mini-roster"></div><div class="hud-room">ROOM <span id="hud-room-code">PUBLIC</span> <i></i> <span id="hud-ping">— MS</span></div></div>
      <div class="match-heading"><div class="match-mode">FREE-FOR-ALL</div><div class="match-time" id="match-time">05:00</div><div class="match-rule"><span></span> THE FOUNDRY <span></span></div></div>
      <button class="hud-menu" id="hud-menu" title="Pause menu"><kbd>ESC</kbd> MENU</button>
      <div class="kill-feed" id="kill-feed" aria-live="polite"></div>
      <div class="crosshair" id="crosshair" aria-hidden="true"><span></span><span></span><span></span><span></span><i></i></div>
      <div class="hit-marker" id="hit-marker" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="damage-flash" id="damage-flash" aria-hidden="true"></div>
      <div class="kill-confirmation" id="kill-confirmation"><span>ELIMINATED</span> <strong id="kill-name"></strong><b>+100</b></div>
      <div class="player-vitals"><div class="health-icon">+</div><span id="health-value">100</span><div class="health-stack"><span>HEALTH</span><div class="health-track"><i id="health-bar"></i></div></div></div>
      <div class="speed-display"><div><span id="speed-value">0.0</span><span class="speed-unit">M/S</span></div><div class="speed-track"><i id="speed-bar"></i></div><span class="speed-caption">KEEP MOVING.</span></div>
      <div class="weapon-hud"><div class="weapon-name">VANGUARD <span>AR</span></div><div class="ammo-count"><span id="ammo-value">30</span><span class="ammo-divider">/</span><span id="ammo-max">30</span></div><span class="reload-label" id="reload-label"><kbd>R</kbd> RELOAD</span></div>
      <div class="hud-bottom-hint"><kbd>TAB</kbd> SCOREBOARD <span>·</span> <kbd>SHIFT</kbd> SLIDE</div>
      <div class="respawn-overlay" id="respawn-overlay" hidden><span class="eyebrow">YOU'LL BE BACK.</span><h2>WIPED OUT<span>.</span></h2><p>REDEPLOYING IN <strong id="respawn-count">3</strong></p></div>
    </div>

    <div class="scoreboard-overlay" id="scoreboard" hidden><section class="scoreboard-panel"><div class="scoreboard-heading"><div><span class="eyebrow">THE FOUNDRY / FREE-FOR-ALL</span><h2>THE LINEUP<span>.</span></h2></div><span class="scoreboard-live"><i></i> LIVE MATCH</span></div><table><thead><tr><th>#</th><th>PLAYER</th><th>KILLS</th><th>DEATHS</th><th>PING</th></tr></thead><tbody id="scoreboard-body"></tbody></table><div class="scoreboard-footer">KEEP MOVING. STAY DANGEROUS.<span><kbd>TAB</kbd> TO CLOSE</span></div></section></div>

    <div class="modal-backdrop" id="modal-backdrop" hidden><section class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button id="modal-close" class="modal-close" aria-label="Close dialog">${icon.close}</button><div id="modal-content"></div></section></div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `);

  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
  const nameInput = $<HTMLInputElement>('#player-name');
  const roomInput = $<HTMLInputElement>('#room-code');
  const lobby = $('#lobby');
  const hud = $('#hud');
  const modalBackdrop = $('#modal-backdrop');
  let toastTimer = 0;
  let previousFocus: HTMLElement | null = null;
  let isDeploying = false;
  let lastFeed = '';
  let hitTimer = 0;
  let damageTimer = 0;
  let killTimer = 0;
  const startingRoom = new URLSearchParams(window.location.search).get('room');
  if (startingRoom) {
    roomInput.value = startingRoom.toUpperCase();
    $('#room-form').hidden = false;
    $('#friends-button').setAttribute('aria-expanded', 'true');
  }

  function showToast(message: string) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function closeModal() {
    modal = null;
    modalBackdrop.hidden = true;
    document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.nav === 'play'));
    previousFocus?.focus();
  }

  function saveSettings() {
    try { localStorage.setItem('drift-settings', JSON.stringify(settings)); } catch { /* Storage is optional. */ }
    callbacks.onSettingsChange({ ...settings });
  }

  function openModal(type: 'controls' | 'settings') {
    modal = type;
    previousFocus = document.activeElement as HTMLElement;
    document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.nav === type));
    const content = $('#modal-content');
    if (type === 'controls') {
      content.innerHTML = `<span class="eyebrow">A LITTLE KNOW-HOW. A LOT OF CHAOS.</span><h2 id="modal-title">GET UP TO SPEED<span>.</span></h2><p class="modal-intro">The arena rewards momentum. Keep your feet moving<br>and your crosshair ready.</p><div class="controls-grid"><div><kbd>W A S D</kbd><span>MOVE</span><p>Find your line through the arena.</p></div><div><kbd>SPACE</kbd><span>JUMP</span><p>Chain jumps to carry your momentum.</p></div><div><kbd>SHIFT</kbd><span>SLIDE</span><p>Slide while moving to pick up speed.</p></div><div><span class="control-mouse">${icon.target}</span><span>AIM & FIRE</span><p>Move your mouse. Click to fire.</p></div><div><kbd>R</kbd><span>RELOAD</span><p>Fresh magazine. Back in the fight.</p></div><div><kbd>TAB</kbd><span>SCOREBOARD</span><p>See how you stack up.</p></div></div><div class="controls-tip"><span>PRO TIP</span> Hold jump to keep hopping. Slide into corners to keep your speed.</div><button class="modal-primary" id="controls-done">GOT IT. LET'S GO. ${icon.arrow}</button>`;
      $('#controls-done').addEventListener('click', closeModal);
    } else {
      content.innerHTML = `<span class="eyebrow">MAKE IT FEEL RIGHT.</span><h2 id="modal-title">YOUR SETUP<span>.</span></h2><p class="modal-intro">Dial in the details. Find your edge.</p><div class="settings-fields"><label class="setting-row"><span><b>MOUSE SENSITIVITY</b><small>Find your perfect flick.</small></span><div class="range-control"><input id="setting-sensitivity" type="range" min="0.2" max="2.5" step="0.05" value="${settings.sensitivity}"><output for="setting-sensitivity">${settings.sensitivity.toFixed(2)}</output></div></label><label class="setting-row"><span><b>FIELD OF VIEW</b><small>A wider view of the action.</small></span><div class="range-control"><input id="setting-fov" type="range" min="75" max="120" step="1" value="${settings.fov}"><output for="setting-fov">${settings.fov}°</output></div></label><label class="setting-row"><span><b>MASTER VOLUME</b><small>Hear the arena around you.</small></span><div class="range-control"><input id="setting-volume" type="range" min="0" max="100" step="1" value="${settings.volume}"><output for="setting-volume">${settings.volume}%</output></div></label><label class="setting-row"><span><b>RENDER QUALITY</b><small>Choose detail or extra frames.</small></span><select id="setting-quality"><option value="high" ${settings.quality === 'high' ? 'selected' : ''}>HIGH</option><option value="low" ${settings.quality === 'low' ? 'selected' : ''}>PERFORMANCE</option></select></label></div><div class="settings-actions"><button class="reset-settings" id="reset-settings">RESET TO DEFAULTS</button><span class="settings-saved">CHANGES SAVE AUTOMATICALLY</span></div><button class="modal-primary" id="settings-done">LOOKING GOOD ${icon.arrow}</button>`;
      (['sensitivity', 'fov', 'volume'] as const).forEach(key => {
        const input = $<HTMLInputElement>(`#setting-${key}`);
        input.addEventListener('input', () => {
          settings[key] = Number(input.value);
          input.nextElementSibling!.textContent = key === 'sensitivity' ? settings[key].toFixed(2) : `${settings[key]}${key === 'fov' ? '°' : '%'}`;
          saveSettings();
        });
      });
      $<HTMLSelectElement>('#setting-quality').addEventListener('change', event => {
        settings.quality = (event.target as HTMLSelectElement).value as GameSettings['quality'];
        saveSettings();
      });
      $('#reset-settings').addEventListener('click', () => { settings = { ...defaults }; saveSettings(); openModal('settings'); showToast('Settings reset. A fresh start.'); });
      $('#settings-done').addEventListener('click', closeModal);
    }
    modalBackdrop.hidden = false;
    $('#modal-close').focus();
  }

  async function deploy() {
    if (mode === 'paused') { callbacks.onResume(); return; }
    if (isDeploying) return;
    const name = nameInput.value.trim().slice(0, 16) || 'WANDERER';
    nameInput.value = name;
    try { localStorage.setItem('drift-name', name); } catch { /* Storage is optional. */ }
    isDeploying = true;
    const deployButton = $<HTMLButtonElement>('#deploy-button');
    deployButton.disabled = true;
    $('#deploy-label').textContent = 'DROPPING IN';
    try { await callbacks.onDeploy(name, roomInput.value.trim().toLowerCase() || 'public'); }
    catch (error) { showToast(error instanceof Error ? error.message : 'Unable to join. Try again.'); }
    finally { isDeploying = false; deployButton.disabled = false; $('#deploy-label').textContent = (mode as UIMode) === 'paused' ? 'RESUME' : 'DEPLOY'; }
  }

  $('#deploy-form').addEventListener('submit', event => { event.preventDefault(); void deploy(); });
  $('.brand').addEventListener('click', event => { event.preventDefault(); closeModal(); });
  $('[data-nav="play"]').addEventListener('click', closeModal);
  $('[data-nav="controls"]').addEventListener('click', () => openModal('controls'));
  $('[data-nav="settings"]').addEventListener('click', () => openModal('settings'));
  $('#modal-close').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });
  $('#friends-button').addEventListener('click', () => {
    const roomForm = $('#room-form');
    roomForm.hidden = !roomForm.hidden;
    $('#friends-button').setAttribute('aria-expanded', String(!roomForm.hidden));
    if (!roomForm.hidden) roomInput.focus();
  });
  $('#copy-invite').addEventListener('click', async () => {
    const room = roomInput.value.trim().toLowerCase();
    try {
      if (callbacks.onCopyInvite) await callbacks.onCopyInvite(room);
      else {
        const url = new URL(window.location.href);
        url.searchParams.set('room', room || 'public');
        await navigator.clipboard.writeText(url.toString());
        showToast('Invite copied. Bring some competition.');
      }
    } catch { showToast('Copy unavailable. Share your room code: ' + (room || 'public').toUpperCase()); }
  });
  $('#leave-match').addEventListener('click', callbacks.onLeave);
  $('#hud-menu').addEventListener('click', () => {
    if (callbacks.onPause) callbacks.onPause();
    else { document.exitPointerLock?.(); setMode('paused'); }
  });
  document.addEventListener('keydown', event => {
    if (!modal) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeModal(); }
    if (event.code === 'Tab') {
      const focusable = Array.from($('#modal').querySelectorAll<HTMLElement>('button, input, select'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);

  function setMode(next: UIMode) {
    mode = next;
    app.dataset.mode = mode;
    lobby.hidden = mode === 'playing';
    hud.hidden = mode !== 'playing';
    $('#scoreboard').hidden = true;
    $('#deploy-label').textContent = mode === 'paused' ? 'RESUME' : 'DEPLOY';
    $('#deploy-detail').textContent = mode === 'paused' ? 'BACK TO THE ACTION' : 'ENTER THE ARENA';
    $('#hero-title').innerHTML = mode === 'paused' ? 'TAKE A BREATH.<br>THEN TAKE AIM<span class="accent">.</span>' : 'MOVE FAST.<br>HIT HARD<span class="accent">.</span>';
    $('#hero-copy').innerHTML = mode === 'paused' ? 'The arena is still moving.<br>Jump back in when you’re ready.' : 'No downloads. No waiting around.<br>Just you, your reflexes, and everyone in your way.';
    $('.callsign-field').hidden = mode === 'paused';
    $('.field-label').hidden = mode === 'paused';
    $('#friends-area').hidden = mode === 'paused';
    $('#leave-match').hidden = mode !== 'paused';
    if (next === 'playing') closeModal();
  }

  function setScoreboard(players: ScoreboardPlayer[]) {
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('#scoreboard-body').innerHTML = sorted.map((p, i) => `<tr class="${p.isLocal ? 'is-you' : ''}"><td>${String(i + 1).padStart(2, '0')}</td><td>${escapeHTML(p.name)}${p.isLocal ? '<span class="you-tag">YOU</span>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.ping ?? '—'}<small> MS</small></td></tr>`).join('');
    renderMiniRoster(sorted);
  }

  function renderMiniRoster(players: ScoreboardPlayer[]) {
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('#mini-roster').innerHTML = sorted.slice(0, 3).map((p, i) => `<div class="roster-row ${p.isLocal ? 'is-you' : ''}"><span>${String(i + 1).padStart(2, '0')}</span><b>${escapeHTML(p.name)}</b><strong>${p.kills}</strong></div>`).join('');
  }

  function updateHud(data: HudData) {
    $('#health-value').textContent = String(Math.max(0, Math.ceil(data.health)));
    $('#health-bar').style.width = `${Math.min(100, Math.max(0, data.health))}%`;
    $('.player-vitals').classList.toggle('is-low', data.health <= 30);
    $('#ammo-value').textContent = data.reloading ? '—' : String(data.ammo).padStart(2, '0');
    $('#ammo-max').textContent = String(data.maxAmmo);
    $('.weapon-hud').classList.toggle('is-low', data.ammo <= 5 && !data.reloading);
    $('#reload-label').innerHTML = data.reloading ? 'RELOADING…' : '<kbd>R</kbd> RELOAD';
    $('#speed-value').textContent = Math.max(0, data.speed).toFixed(1);
    $('#speed-bar').style.width = `${Math.min(100, Math.max(0, data.speed) / 17 * 100)}%`;
    const time = Math.max(0, Math.ceil(data.time));
    $('#match-time').textContent = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
    if (data.ping !== undefined) $('#hud-ping').textContent = `${Math.round(data.ping)} MS`;
    if (data.onlineCount !== undefined) $('.map-tag').textContent = `${data.onlineCount} / 8 IN ARENA`;
    if (data.leaderboard) renderMiniRoster(data.leaderboard);
    if (data.killFeed) {
      const feed = JSON.stringify(data.killFeed);
      if (feed !== lastFeed) {
        lastFeed = feed;
        $('#kill-feed').innerHTML = data.killFeed.slice(0, 4).map(entry => `<div class="kill-entry ${entry.isLocal ? 'is-local' : ''}"><span>${escapeHTML(entry.killer)}</span><i>⌁</i><span>${escapeHTML(entry.victim)}</span></div>`).join('');
      }
    }
    const dead = data.respawnIn !== undefined && data.respawnIn > 0;
    $('#respawn-overlay').hidden = !dead;
    $('#crosshair').hidden = dead;
    if (dead) $('#respawn-count').textContent = String(Math.ceil(data.respawnIn!));
  }

  setMode('lobby');
  return {
    updateHud,
    setMode,
    showMenu: () => setMode('paused'),
    setServerStatus: (label: string, online: boolean) => { $('#server-status-text').textContent = label; $('.server-status').classList.toggle('is-online', online); },
    showScoreboard: (show: boolean) => { $('#scoreboard').hidden = !show || mode !== 'playing'; },
    setScoreboard,
    showToast,
    getSettings: () => ({ ...settings }),
    setRoomCode: (code: string) => { roomInput.value = code === 'public' ? '' : code.toUpperCase(); $('#hud-room-code').textContent = code.toUpperCase(); },
    setPlayerName: (name: string) => { nameInput.value = name; },
    setPlatformLabel: (label: string) => { $('#platform-label').textContent = label; },
    flashHit: (headshot = false) => {
      const marker = $('#hit-marker');
      marker.classList.add('is-visible');
      marker.classList.toggle('is-headshot', headshot);
      window.clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => marker.classList.remove('is-visible'), 140);
    },
    flashDamage: () => {
      $('#damage-flash').classList.add('is-visible');
      window.clearTimeout(damageTimer);
      damageTimer = window.setTimeout(() => $('#damage-flash').classList.remove('is-visible'), 230);
    },
    flashKill: (name: string) => {
      $('#kill-name').textContent = name;
      $('#kill-confirmation').classList.add('is-visible');
      window.clearTimeout(killTimer);
      killTimer = window.setTimeout(() => $('#kill-confirmation').classList.remove('is-visible'), 1900);
    },
  };
}
