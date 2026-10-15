import * as THREE from 'three';
import { setupUI } from './ui';
import { GameAudio } from './audio';
import { getPlatformContext, getWebSocketUrl, type PlatformContext } from './platform';
import { createWorld, createViewmodel, createAvatar, disposeAvatar, addTracer, type Avatar } from './world';
import {
  createPlayerState, movePlayer, EMPTY_INPUT, EYE_HEIGHT, CROUCH_EYE_HEIGHT,
  MAGAZINE_SIZE, FIRE_INTERVAL, type PlayerState, type PlayerInput,
  type PublicPlayer, type ServerMessage, type GameSnapshot, type GameEvent,
} from '../shared/game';

type Mode = 'lobby' | 'playing' | 'paused';
const audio = new GameAudio();
let platform: PlatformContext = { kind: 'browser', label: 'BROWSER' };
let mode: Mode = 'lobby';
let socket: WebSocket | null = null;
let localId = '', room = 'public';
let local: PublicPlayer | null = null;
let predicted: PlayerState = createPlayerState();
let yaw = 0, pitch = 0;
let sequence = 0, ping = 0, lastPing = 0, serverOffset = 0;
let generation = 0, connecting = false;
let timeLeft = 300, snapshotAt = performance.now();
let lastEvent = 0, lastShot = -10, recoil = 0, reloadAnimation = 0, swayX = 0, swayY = 0;
let mouseDown = false, aiming = false, reloadRequested = false;
let cameraHeight = EYE_HEIGHT, bobTime = 0;
let pointerCaptureSupported = true;
const keys = new Set<string>();
const history = new Map<number, PlayerState>();
const avatars = new Map<string, Avatar>();
let players: PublicPlayer[] = [];
let killFeed: { killer: string; victim: string; isLocal: boolean; at: number }[] = [];
let settings = { sensitivity: 1, fov: 100, volume: 60, quality: 'high' };

const normalizeRoom = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'public';
const initialRoom = normalizeRoom(new URLSearchParams(location.search).get('room') ?? 'public');

const ui = setupUI({
  onDeploy: (name, requestedRoom) => deploy(name, requestedRoom),
  onResume: () => { if (localId) { setMode('playing'); capturePointer(); audio.unlock(); } },
  onPause: () => setMode('paused'),
  onLeave: () => leaveGame(),
  onSettingsChange: value => {
    settings = value;
    audio.setVolume(value.volume);
    world?.setQuality(value.quality);
  },
  onCopyInvite: async requestedRoom => {
    const inviteRoom = localId ? room : normalizeRoom(requestedRoom || `crew-${Math.random().toString(36).slice(2, 8)}`);
    ui.setRoomCode(inviteRoom);
    const url = new URL(location.href);
    url.search = ''; url.searchParams.set('room', inviteRoom);
    try {
      await navigator.clipboard.writeText(url.toString());
      ui.showToast('Invite copied. Share it with your crew.');
    } catch {
      const field = document.createElement('textarea'); field.value = url.toString();
      document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      ui.showToast(copied ? 'Invite copied. Share it with your crew.' : `Invite: ${url.toString()}`);
    }
  },
});
settings = ui.getSettings();
ui.setRoomCode(initialRoom === 'public' ? '' : initialRoom);
try { ui.setPlayerName(localStorage.getItem('drift-name') ?? ''); } catch { /* storage can be restricted in embeds */ }

let world: ReturnType<typeof createWorld>;
try {
  world = createWorld(document.querySelector<HTMLCanvasElement>('#game-canvas')!);
} catch (error) {
  console.error(error);
  ui.setServerStatus('WEBGL 2 REQUIRED', false);
  ui.showToast('Your browser could not start WebGL 2. Enable hardware acceleration and reload.');
  throw error;
}
world.setQuality(settings.quality);
audio.setVolume(settings.volume);
const { renderer, camera, scene } = world;
const viewmodel = createViewmodel();
const tracers: ReturnType<typeof addTracer>[] = [];

function setMode(value: Mode) {
  mode = value; ui.setMode(value);
  document.body.dataset.gameMode = value;
  if (value !== 'playing') {
    clearInput();
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function capturePointer() {
  const canvas = renderer.domElement;
  if (!canvas.requestPointerLock) { pointerCaptureSupported = false; ui.showToast('Hold the mouse button to look around.'); return; }
  try {
    const promise = canvas.requestPointerLock() as Promise<void> | undefined;
    promise?.catch(() => {
      pointerCaptureSupported = false;
      ui.showToast('Mouse capture unavailable. Hold the mouse button to look around.');
    });
  } catch { pointerCaptureSupported = false; }
}

function clearInput() { keys.clear(); mouseDown = false; aiming = false; reloadRequested = false; }

function leaveGame() {
  generation++; connecting = false;
  socket?.close(); socket = null; localId = ''; local = null; players = [];
  for (const avatar of avatars.values()) disposeAvatar(avatar);
  avatars.clear(); history.clear(); killFeed = []; lastEvent = 0;
  setMode('lobby');
  ui.setServerStatus('SERVER ONLINE', true);
}

async function deploy(name: string, requestedRoom: string) {
  if (connecting) return;
  if (localId && socket?.readyState === WebSocket.OPEN) { setMode('playing'); capturePointer(); return; }
  audio.unlock();
  const playerName = name.trim().slice(0, 18) || `Runner${Math.floor(Math.random() * 900 + 100)}`;
  ui.setPlayerName(playerName);
  try { localStorage.setItem('drift-name', playerName); } catch { /* optional preference */ }
  connecting = true;
  const currentGeneration = ++generation;
  ui.setServerStatus('CONNECTING…', false);
  predicted = createPlayerState(); yaw = 0; pitch = 0; cameraHeight = EYE_HEIGHT;
  setMode('playing'); capturePointer();
  // Capture the mouse in the click gesture, but finish the Activity handshake
  // before selecting a room so a quick deployment cannot enter the public room.
  platform = await getPlatformContext();
  if (currentGeneration !== generation) return;
  room = normalizeRoom(platform.room ?? requestedRoom);
  ui.setRoomCode(room);
  sequence = 0; history.clear(); lastEvent = 0; killFeed = [];
  const connection = new WebSocket(getWebSocketUrl()); socket = connection;
  const timeout = setTimeout(() => {
    if (currentGeneration === generation && !localId) {
      connection.close();
      ui.showToast('Connection timed out. Check that the game server is running.');
    }
  }, 8_000);
  connection.addEventListener('open', () => {
    connection.send(JSON.stringify({ type: 'join', name: playerName, room }));
  });
  connection.addEventListener('message', event => {
    if (currentGeneration !== generation) return;
    let message: ServerMessage;
    try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { return; }
    if (message.type === 'joined') {
      clearTimeout(timeout); connecting = false; localId = message.id; room = message.room;
      ui.setRoomCode(room); ui.setServerStatus('CONNECTED', true);
      if (platform.kind === 'browser') {
        const url = new URL(location.href); url.searchParams.set('room', room); historyReplace(url);
      }
    } else if (message.type === 'snapshot') receiveSnapshot(message);
    else if (message.type === 'pong') ping = Math.max(0, Math.round(Date.now() - message.at));
    else if (message.type === 'error') {
      ui.showToast(message.message);
      if (!localId) { connection.close(); setMode('lobby'); }
    }
  });
  connection.addEventListener('close', () => {
    clearTimeout(timeout);
    if (currentGeneration !== generation) return;
    const hadJoined = Boolean(localId);
    localId = ''; local = null; socket = null; connecting = false;
    for (const avatar of avatars.values()) disposeAvatar(avatar);
    avatars.clear(); players = []; setMode('lobby');
    ui.setServerStatus('SERVER DISCONNECTED', false);
    if (hadJoined) ui.showToast('Connection lost. Deploy again to rejoin.');
    else ui.showToast('Could not join. Start the server with npm run dev.');
  });
  connection.addEventListener('error', () => ui.setServerStatus('CONNECTION FAILED', false));
}

function historyReplace(url: URL) { try { window.history.replaceState({}, '', url); } catch { /* iframe URL may be immutable */ } }

function receiveSnapshot(snapshot: GameSnapshot) {
  serverOffset = snapshot.serverTime - Date.now();
  timeLeft = snapshot.timeLeft; snapshotAt = performance.now(); players = snapshot.players;
  const author = players.find(player => player.id === localId);
  if (author) {
    const first = !local;
    const respawned = local && local.health <= 0 && author.health > 0;
    if (first || respawned) {
      predicted = { ...author }; yaw = author.yaw; pitch = author.pitch;
      history.clear(); clearInput(); cameraHeight = EYE_HEIGHT;
    } else if (author.health > 0) {
      const previousPrediction = history.get(author.ackSeq);
      if (previousPrediction) {
        const dx = author.x - previousPrediction.x, dy = author.y - previousPrediction.y, dz = author.z - previousPrediction.z;
        const error = Math.hypot(dx, dy, dz);
        if (error > 4) { predicted = { ...author }; history.clear(); }
        else if (error > .035) {
          predicted.x += dx * .75; predicted.y += dy * .75; predicted.z += dz * .75;
          // Rebase unacknowledged history along with the visible prediction.
          for (const [seq, state] of history) if (seq > author.ackSeq) { state.x += dx * .75; state.y += dy * .75; state.z += dz * .75; }
        }
      } else if (Math.hypot(author.x - predicted.x, author.y - predicted.y, author.z - predicted.z) > 5) predicted = { ...author };
      for (const seq of history.keys()) if (seq <= author.ackSeq) history.delete(seq);
    }
    if (!local?.reloading && author.reloading) { reloadAnimation = 1; audio.reload(); }
    local = author;
    if (author.health <= 0) { mouseDown = false; aiming = false; }
  }
  const present = new Set(players.map(player => player.id));
  for (const [id, avatar] of avatars) {
    if (!present.has(id) || id === localId) { disposeAvatar(avatar); avatars.delete(id); }
  }
  for (const player of players) {
    if (player.id === localId) continue;
    let avatar = avatars.get(player.id);
    if (!avatar) {
      avatar = createAvatar(player); avatar.group.position.set(player.x, player.y, player.z);
      avatars.set(player.id, avatar); scene.add(avatar.group);
    }
    if (Math.hypot(avatar.target.x - player.x, avatar.target.z - player.z) > 6) avatar.group.position.set(player.x, player.y, player.z);
    avatar.target = player;
    avatar.group.visible = player.health > 0;
  }
  for (const event of snapshot.events) if (event.id > lastEvent) { handleEvent(event); lastEvent = event.id; }
  ui.setScoreboard(players.map(player => ({ name: player.name + (player.isBot ? ' [BOT]' : ''), kills: player.kills, deaths: player.deaths, isLocal: player.id === localId })));
}

function handleEvent(event: GameEvent) {
  if (event.type === 'shot') {
    if (event.playerId !== localId) {
      tracers.push(addTracer(scene, event.from, event.to));
      const distance = Math.hypot(event.from.x - predicted.x, event.from.z - predicted.z);
      if (distance < 24) audio.shot(true);
    }
    if (event.playerId === localId && event.hitPlayerId) {
      ui.flashHit(event.headshot);
      audio.hit(event.headshot);
    }
  } else if (event.type === 'damage' && event.playerId === localId) {
    ui.flashDamage(); audio.damage();
  } else if (event.type === 'kill') {
    killFeed.unshift({ killer: event.killerName, victim: event.victimName, isLocal: event.killerId === localId, at: performance.now() });
    killFeed = killFeed.slice(0, 5);
    if (event.killerId === localId) {
      ui.flashKill(event.victimName); audio.kill();
    }
  } else if (event.type === 'match') ui.showToast(event.message);
}

function sampleInput(): PlayerInput {
  const active = mode === 'playing' && Boolean(local) && local!.health > 0;
  return {
    ...EMPTY_INPUT, seq: ++sequence, yaw, pitch,
    forward: active ? Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) : 0,
    strafe: active ? Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) : 0,
    jump: active && keys.has('Space'),
    crouch: active && (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('ControlLeft') || keys.has('ControlRight')),
    sprint: !(keys.has('ControlLeft') || keys.has('ControlRight')),
    fire: active && mouseDown,
    reload: active && reloadRequested,
  };
}

function simulate() {
  if (!localId || socket?.readyState !== WebSocket.OPEN) return;
  const input = sampleInput();
  if (local && local.health > 0) {
    const wasGrounded = predicted.grounded;
    movePlayer(predicted, input, 1 / 60);
    if (input.jump && wasGrounded && !predicted.grounded) audio.jump();
    history.set(input.seq, { ...predicted });
    if (history.size > 240) history.delete(history.keys().next().value!);
  }
  socket.send(JSON.stringify({ type: 'input', ...input }));
  reloadRequested = false;
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && mode === 'playing' && localId && pointerCaptureSupported) setMode('paused');
});
document.addEventListener('pointerlockerror', () => { pointerCaptureSupported = false; });
document.addEventListener('mousemove', event => {
  if (mode !== 'playing' || (!document.pointerLockElement && (pointerCaptureSupported || event.buttons === 0))) return;
  const sensitivity = .002 * settings.sensitivity * (aiming ? .6 : 1);
  yaw -= event.movementX * sensitivity;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * sensitivity, -1.47, 1.47);
  yaw %= Math.PI * 2;
  swayX = THREE.MathUtils.clamp(swayX + event.movementX * .0002, -.025, .025);
  swayY = THREE.MathUtils.clamp(swayY + event.movementY * .0002, -.025, .025);
});
renderer.domElement.addEventListener('mousedown', event => {
  if (mode !== 'playing') return;
  if (event.button === 0) mouseDown = true;
  if (event.button === 2) aiming = true;
  if (!document.pointerLockElement && pointerCaptureSupported) capturePointer();
});
document.addEventListener('mouseup', event => { if (event.button === 0) mouseDown = false; if (event.button === 2) aiming = false; });
renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', event => {
  if (mode !== 'playing') return;
  if (['Space', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'KeyR' && !event.repeat) reloadRequested = true;
  if (event.code === 'Tab') ui.showScoreboard(true);
  if (event.code === 'Escape' && !document.pointerLockElement) setMode('paused');
});
document.addEventListener('keyup', event => { keys.delete(event.code); if (event.code === 'Tab') ui.showScoreboard(false); });
window.addEventListener('blur', () => { clearInput(); if (mode === 'playing' && localId) setMode('paused'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = viewmodel.camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); viewmodel.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let previous = performance.now(), accumulator = 0, hudAt = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - previous) / 1000, .05); previous = now;
  accumulator += dt;
  for (let steps = 0; accumulator >= 1 / 60 && steps < 4; steps++) { simulate(); accumulator -= 1 / 60; }
  const speed = Math.hypot(predicted.vx, predicted.vz);
  const alpha = 1 - Math.exp(-16 * dt);
  if (mode === 'lobby') {
    const time = now * .000045;
    camera.position.set(21 + Math.sin(time) * 1.3, 12.4 + Math.cos(time) * .3, 26 + Math.cos(time) * 1.2);
    camera.lookAt(-5, 1.8, -7);
    camera.fov = 65;
  } else {
    const targetHeight = local && local.health <= 0 ? .78 : predicted.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    cameraHeight = THREE.MathUtils.lerp(cameraHeight, targetHeight, 1 - Math.exp(-14 * dt));
    bobTime += dt * speed * 1.4;
    const bob = predicted.grounded && speed > 1 ? Math.sin(bobTime * 2) * .018 : 0;
    camera.position.set(predicted.x, predicted.y + cameraHeight + bob, predicted.z);
    camera.rotation.set(pitch + recoil * .013, yaw, predicted.slideTimer > 0 ? .025 * Math.sin(bobTime * .5) : 0, 'YXZ');
    const targetFov = aiming ? settings.fov * .72 : settings.fov + Math.min(7, Math.max(0, speed - 9));
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, alpha);
    const seconds = now / 1000;
    if (mouseDown && local && local.health > 0 && !local.reloading && local.ammo > 0 && seconds - lastShot >= FIRE_INTERVAL) {
      lastShot = seconds; recoil = Math.min(1.4, recoil + .8); audio.shot();
      viewmodel.flash.visible = true;
      viewmodel.flash.rotation.z = Math.random() * Math.PI;
    } else if (seconds - lastShot > .035) viewmodel.flash.visible = false;
  }
  camera.updateProjectionMatrix();
  recoil = Math.max(0, recoil - dt * 8);
  reloadAnimation = Math.max(0, reloadAnimation - dt / 1.35);
  swayX *= Math.exp(-9 * dt); swayY *= Math.exp(-9 * dt);
  const bobScale = predicted.grounded ? Math.min(speed / 10, 1) : .2;
  const reloadDip = Math.sin(reloadAnimation * Math.PI);
  viewmodel.rig.position.set(
    THREE.MathUtils.lerp(viewmodel.rig.position.x, (aiming ? 0 : .28) + Math.sin(bobTime) * .009 * bobScale - swayX, alpha),
    THREE.MathUtils.lerp(viewmodel.rig.position.y, (aiming ? -.174 : -.27) + Math.cos(bobTime * 2) * .009 * bobScale - reloadDip * .25 + swayY, alpha),
    -.57 + recoil * .065,
  );
  viewmodel.rig.rotation.set(recoil * .06 - reloadDip * .4, reloadDip * -.3, reloadDip * -.65 + swayX);
  viewmodel.camera.fov = aiming ? 59 : 67; viewmodel.camera.updateProjectionMatrix();
  for (const avatar of avatars.values()) {
    const p = avatar.target;
    avatar.group.position.lerp(new THREE.Vector3(p.x, p.y, p.z), alpha);
    let delta = p.yaw - avatar.group.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); avatar.group.rotation.y += delta * alpha;
    const avatarSpeed = Math.hypot(p.vx, p.vz);
    avatar.walk += dt * avatarSpeed * 1.1;
    avatar.leftLeg.rotation.x = Math.sin(avatar.walk) * .65 * Math.min(avatarSpeed / 5, 1);
    avatar.rightLeg.rotation.x = -avatar.leftLeg.rotation.x;
    avatar.group.scale.y = THREE.MathUtils.lerp(avatar.group.scale.y, p.crouching ? .65 : 1, alpha);
    avatar.health.scale.x = .7 * p.health / 100;
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) { tracers[i].dispose(); tracers.splice(i, 1); }
  }
  renderer.autoClear = true; renderer.render(scene, camera);
  if (mode !== 'lobby' && local && local.health > 0) {
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(viewmodel.scene, viewmodel.camera);
  }
  if (now - hudAt > 80) {
    hudAt = now;
    killFeed = killFeed.filter(item => now - item.at < 6500);
    ui.updateHud({
      health: local?.health ?? 100, ammo: local?.ammo ?? MAGAZINE_SIZE, maxAmmo: MAGAZINE_SIZE,
      speed, time: Math.max(0, timeLeft - (now - snapshotAt) / 1000),
      score: local?.score ?? 0, kills: local?.kills ?? 0, deaths: local?.deaths ?? 0,
      reloading: local?.reloading ?? false, ping,
      onlineCount: players.length,
      respawnIn: local && local.health <= 0 ? Math.max(0, (local.respawnAt - Date.now() - serverOffset) / 1000) : 0,
      leaderboard: [...players].sort((a, b) => b.kills - a.kills).slice(0, 3).map(p => ({ name: p.name + (p.isBot ? ' [BOT]' : ''), kills: p.kills, deaths: p.deaths, isLocal: p.id === localId })),
      killFeed,
    });
  }
  if (localId && socket?.readyState === WebSocket.OPEN && now - lastPing > 2500) {
    lastPing = now; socket.send(JSON.stringify({ type: 'ping', at: Date.now() }));
  }
}

async function checkHealth() {
  if (localId || connecting) return;
  try {
    const url = new URL(getWebSocketUrl());
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = url.pathname.includes('/.proxy/') ? '/.proxy/health' : '/health';
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('offline');
    const status = await response.json() as { ok: boolean; players: number };
    ui.setServerStatus(status.ok ? 'SERVER ONLINE' : 'SERVER OFFLINE', status.ok);
  } catch { ui.setServerStatus('SERVER OFFLINE', false); }
}

void getPlatformContext().then(context => {
  platform = context; ui.setPlatformLabel(context.label);
  if (context.room && !localId && !connecting) ui.setRoomCode(context.room);
});
setMode('lobby');
void checkHealth();
setInterval(() => void checkHealth(), 10000);
requestAnimationFrame(frame);
