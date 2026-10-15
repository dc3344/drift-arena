import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  CROUCH_EYE_HEIGHT, CROUCH_HEIGHT, EMPTY_INPUT, EYE_HEIGHT, FIRE_INTERVAL,
  MAGAZINE_SIZE, MAP_SPAWNS, MATCH_SECONDS, PLAYER_HEIGHT, PLAYER_RADIUS,
  RELOAD_SECONDS, RESPAWN_SECONDS, createPlayerState, lookDirection, movePlayer,
  rayBox, rayMap, type GameEvent, type GameSnapshot, type PlayerInput,
  type PublicPlayer, type Vec3,
} from '../shared/game.js';

interface ServerPlayer extends PublicPlayer {
  input: PlayerInput; socket?: WebSocket; nextShotAt: number; reloadAt: number;
  lastInputAt: number; spawnIndex: number; botTargetAt: number; botWaypoint: Vec3;
}
interface Room {
  name: string; players: Map<string, ServerPlayer>; events: GameEvent[]; endsAt: number;
  createdAt: number; lastHumanAt: number; spawnCounter: number;
}
interface Client {
  socket: WebSocket; id?: string; room?: Room; joinedAt: number; lastPongAt: number;
  rateWindow: number; messages: number; invalid: number;
}
export interface GameServerOptions {
  port?: number; host?: string; staticDir?: string; botsPerRoom?: number;
  maxRooms?: number; maxPlayersPerRoom?: number; matchSeconds?: number;
  /** Explicit spawn points also support deterministic integration tests. */
  spawnPoints?: (Vec3 & { yaw: number })[];
}

const COLORS = [0xffb457, 0x5bd6d0, 0xe9879b, 0xb4a0ed, 0xe0d780, 0x79bbec, 0x9dd28b, 0xe7a272];
const BOT_NAMES = ['Rivet', 'Mica', 'Flux'];
const STEP = 1 / 60;
const MAX_PAYLOAD = 4096;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

export function normalizeRoom(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'public' : 'public';
}
export function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 18) || 'Runner' : 'Runner';
}
function validInput(message: Record<string, unknown>): PlayerInput | null {
  const finite = (name: string) => typeof message[name] === 'number' && Number.isFinite(message[name]);
  if (!['seq', 'forward', 'strafe', 'yaw', 'pitch'].every(finite)
    || !['jump', 'crouch', 'sprint', 'fire', 'reload'].every(key => typeof message[key] === 'boolean')
    || !Number.isSafeInteger(message.seq) || (message.seq as number) < 0) return null;
  return {
    seq: message.seq as number,
    forward: Math.max(-1, Math.min(1, message.forward as number)),
    strafe: Math.max(-1, Math.min(1, message.strafe as number)),
    yaw: (message.yaw as number) % (Math.PI * 2),
    pitch: Math.max(-1.48, Math.min(1.48, message.pitch as number)),
    jump: message.jump as boolean, crouch: message.crouch as boolean,
    sprint: message.sprint as boolean, fire: message.fire as boolean, reload: message.reload as boolean,
  };
}
function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    if (socket.bufferedAmount > 512 * 1024) socket.close(1008, 'Connection too slow');
    else socket.send(JSON.stringify(payload));
  }
}
function publicPlayer(player: ServerPlayer): PublicPlayer {
  return {
    id: player.id, name: player.name, color: player.color, isBot: player.isBot,
    x: player.x, y: player.y, z: player.z, vx: player.vx, vy: player.vy, vz: player.vz,
    grounded: player.grounded, crouching: player.crouching, slideTimer: player.slideTimer,
    slideCooldown: player.slideCooldown, yaw: player.yaw, pitch: player.pitch,
    health: player.health, ammo: player.ammo, reloading: player.reloading,
    respawnAt: player.respawnAt, score: player.score, kills: player.kills, deaths: player.deaths,
    ackSeq: player.ackSeq,
  };
}

export async function createGameServer(options: GameServerOptions = {}) {
  const botsPerRoom = Math.max(0, Math.min(3, options.botsPerRoom ?? 3));
  const maxPlayers = Math.max(2, Math.min(8, options.maxPlayersPerRoom ?? 8));
  const spawnPoints = options.spawnPoints?.length ? options.spawnPoints : MAP_SPAWNS;
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  let now = Date.now(), tick = 0, eventId = 0;
  const staticRoot = options.staticDir ? resolve(options.staticDir) : undefined;

  function httpHandler(req: IncomingMessage, res: ServerResponse): void {
    if (req.url?.split('?')[0] === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...clients].filter(client => client.id).length }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (!staticRoot) { res.writeHead(404); res.end('Game server ready. Start the Vite client or build the frontend.'); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end('Bad path'); return; }
    let file = resolve(staticRoot, `.${pathname}`);
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) { res.writeHead(403); res.end(); return; }
    try {
      if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, 'index.html');
      if (!existsSync(file)) {
        if (extname(pathname)) { res.writeHead(404); res.end('Not found'); return; }
        file = resolve(staticRoot, 'index.html');
      }
      if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Build the frontend first.'); return; }
      const extension = extname(file);
      res.writeHead(200, {
        'content-type': MIME[extension] ?? 'application/octet-stream',
        'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
        // Discord Activities are intentionally permitted to embed this application.
        'referrer-policy': 'strict-origin-when-cross-origin',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(500); res.end('Unable to read asset'); }
  }

  const server = createServer(httpHandler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const path = req.url?.split('?')[0];
    if (path !== '/ws' && path !== '/.proxy/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    if (clients.size >= 256) { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  function addEvent(room: Room, event: Omit<Extract<GameEvent, { type: 'shot' }>, 'id'>
    | Omit<Extract<GameEvent, { type: 'kill' }>, 'id'>
    | Omit<Extract<GameEvent, { type: 'damage' }>, 'id'>
    | Omit<Extract<GameEvent, { type: 'match' }>, 'id'>): void {
    room.events.push({ ...event, id: ++eventId } as GameEvent);
  }
  function newRoom(name: string): Room {
    const room: Room = { name, players: new Map(), events: [],
      endsAt: now + (options.matchSeconds ?? MATCH_SECONDS) * 1000,
      createdAt: now, lastHumanAt: now, spawnCounter: 0 };
    rooms.set(name, room); return room;
  }
  function pickSpawn(room: Room, initial = false) {
    if (initial) return room.spawnCounter++ % spawnPoints.length;
    let best = 0, bestDistance = -Infinity;
    for (let i = 0; i < spawnPoints.length; i++) {
      const spot = spawnPoints[i];
      const nearest = Math.min(1000, ...[...room.players.values()].filter(player => player.health > 0)
        .map(player => Math.hypot(player.x - spot.x, player.z - spot.z)));
      if (nearest > bestDistance) { best = i; bestDistance = nearest; }
    }
    return best;
  }
  function respawn(player: ServerPlayer, room: Room, initial = false): void {
    const index = pickSpawn(room, initial), spot = spawnPoints[index];
    Object.assign(player, createPlayerState(spot));
    player.spawnIndex = index; player.yaw = spot.yaw; player.pitch = 0;
    player.health = 100; player.ammo = MAGAZINE_SIZE; player.reloading = false;
    player.reloadAt = 0; player.respawnAt = 0; player.nextShotAt = now + 250;
    player.input = { ...EMPTY_INPUT, seq: player.ackSeq, yaw: spot.yaw };
  }
  function addPlayer(room: Room, name: string, isBot: boolean, socket?: WebSocket): ServerPlayer {
    const player: ServerPlayer = {
      ...createPlayerState(), id: randomUUID(), name, isBot, socket,
      color: COLORS[room.players.size % COLORS.length], yaw: 0, pitch: 0,
      health: 100, ammo: MAGAZINE_SIZE, reloading: false, respawnAt: 0,
      score: 0, kills: 0, deaths: 0, ackSeq: 0, input: { ...EMPTY_INPUT },
      nextShotAt: 0, reloadAt: 0, lastInputAt: now, spawnIndex: 0,
      botTargetAt: 0, botWaypoint: { x: 0, y: 0, z: 0 },
    };
    respawn(player, room, true); room.players.set(player.id, player); return player;
  }
  function balanceBots(room: Room): void {
    const humans = [...room.players.values()].filter(player => !player.isBot).length;
    const bots = [...room.players.values()].filter(player => player.isBot);
    const desired = Math.min(botsPerRoom, Math.max(0, maxPlayers - humans));
    while (bots.length > desired) room.players.delete(bots.pop()!.id);
    for (let i = bots.length; i < desired; i++) addPlayer(room, BOT_NAMES[i] ?? `Bot ${i + 1}`, true);
  }
  function snapshot(room: Room, events: GameEvent[] = []): GameSnapshot {
    return { type: 'snapshot', tick, serverTime: now, room: room.name,
      timeLeft: Math.max(0, (room.endsAt - now) / 1000),
      players: [...room.players.values()].map(publicPlayer), events };
  }
  function reject(client: Client, message: string): void {
    send(client.socket, { type: 'error', message });
  }
  function invalid(client: Client): void {
    if (++client.invalid >= 5) client.socket.close(1008, 'Invalid messages');
  }
  function handleMessage(client: Client, data: RawData, isBinary: boolean): void {
    if (Date.now() - client.rateWindow >= 1000) { client.rateWindow = Date.now(); client.messages = 0; }
    if (++client.messages > 150) { client.socket.close(1008, 'Message rate exceeded'); return; }
    if (isBinary) { invalid(client); return; }
    let message: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(data.toString());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { invalid(client); return; }
      message = parsed as Record<string, unknown>;
    } catch { invalid(client); return; }
    if (message.type === 'ping' && typeof message.at === 'number' && Number.isFinite(message.at)) {
      send(client.socket, { type: 'pong', at: message.at }); return;
    }
    if (message.type === 'join') {
      if (client.id) { reject(client, 'Already connected to a room.'); return; }
      const roomName = normalizeRoom(message.room);
      let room = rooms.get(roomName);
      if (!room) {
        if (rooms.size >= (options.maxRooms ?? 64)) { reject(client, 'Server is full. Try again shortly.'); return; }
        room = newRoom(roomName);
      }
      const humanCount = [...room.players.values()].filter(player => !player.isBot).length;
      if (humanCount >= maxPlayers) { reject(client, 'This room is full. Choose another room.'); return; }
      if (room.players.size >= maxPlayers) {
        const bot = [...room.players.values()].find(player => player.isBot);
        if (bot) room.players.delete(bot.id);
      }
      const player = addPlayer(room, normalizeName(message.name), false, client.socket);
      client.id = player.id; client.room = room; room.lastHumanAt = now;
      balanceBots(room);
      send(client.socket, { type: 'joined', id: player.id, room: roomName });
      send(client.socket, snapshot(room));
      return;
    }
    if (message.type === 'input' && client.id && client.room) {
      const input = validInput(message), player = client.room.players.get(client.id);
      if (!input) { invalid(client); return; }
      if (player && input.seq > player.input.seq) { player.input = input; player.lastInputAt = now; }
      return;
    }
    invalid(client);
  }
  wss.on('connection', socket => {
    const timestamp = Date.now();
    const client: Client = { socket, joinedAt: timestamp, lastPongAt: timestamp,
      rateWindow: timestamp, messages: 0, invalid: 0 };
    clients.add(client);
    socket.on('message', (data, binary) => handleMessage(client, data, binary));
    socket.on('pong', () => { client.lastPongAt = Date.now(); });
    socket.on('error', () => { /* Close event performs cleanup. */ });
    socket.on('close', () => {
      clients.delete(client);
      if (client.id && client.room) {
        client.room.players.delete(client.id); client.room.lastHumanAt = now;
        balanceBots(client.room);
      }
    });
  });

  function botInput(bot: ServerPlayer, room: Room): PlayerInput {
    const others = [...room.players.values()].filter(player => player.id !== bot.id && player.health > 0);
    let target: ServerPlayer | undefined, targetDistance = Infinity;
    for (const other of others) {
      const eye = { x: bot.x, y: bot.y + EYE_HEIGHT, z: bot.z };
      const dx = other.x - bot.x, dy = other.y + 1.05 - eye.y, dz = other.z - bot.z;
      const distance = Math.hypot(dx, dy, dz);
      const visible = rayMap(eye, { x: dx / distance, y: dy / distance, z: dz / distance }, distance) >= distance - .1;
      if (visible && distance < targetDistance) { target = other; targetDistance = distance; }
    }
    if (now > bot.botTargetAt || Math.hypot(bot.botWaypoint.x - bot.x, bot.botWaypoint.z - bot.z) < 2) {
      bot.botTargetAt = now + 3000;
      const waypoints = [
        { x: 0, y: 0, z: 11 }, { x: 0, y: 0, z: -11 },
        { x: -8, y: 0, z: 0 }, { x: 8, y: 0, z: 0 },
        { x: -23, y: 0, z: 0 }, { x: 23, y: 0, z: 0 },
        { x: -8, y: 0, z: -16 }, { x: 8, y: 0, z: 16 },
      ];
      bot.botWaypoint = waypoints[Math.floor(Math.random() * waypoints.length)];
    }
    const aimX = (target ?? bot.botWaypoint).x - bot.x;
    const aimZ = (target ?? bot.botWaypoint).z - bot.z;
    const idealYaw = Math.atan2(-aimX, -aimZ);
    let difference = Math.atan2(Math.sin(idealYaw - bot.yaw), Math.cos(idealYaw - bot.yaw));
    difference = Math.max(-.08, Math.min(.08, difference));
    const yaw = Math.atan2(Math.sin(bot.yaw + difference), Math.cos(bot.yaw + difference));
    const idealPitch = target ? Math.atan2(target.y + 1.1 - bot.y - EYE_HEIGHT, Math.hypot(aimX, aimZ)) : 0;
    const pitch = bot.pitch + (idealPitch - bot.pitch) * .12;
    const forward = target ? targetDistance > 14 ? .75 : .1 : .9;
    const strafe = target ? Math.sin(now / 1000 + bot.spawnIndex) * .7 : 0;
    const aligned = Math.abs(Math.atan2(Math.sin(idealYaw - yaw), Math.cos(idealYaw - yaw))) < .12;
    return { seq: bot.input.seq + 1, forward, strafe, yaw,
      // A modest oscillation intentionally gives practice bots fallible aim.
      pitch: pitch + (target ? Math.sin(now / 280 + bot.spawnIndex) * .008 : 0),
      jump: !target && Math.hypot(bot.vx, bot.vz) < 1 && tick % 80 < 2,
      crouch: false, sprint: !target, fire: Boolean(target && aligned && tick % 3 === 0),
      reload: bot.ammo === 0 };
  }

  function fire(player: ServerPlayer, room: Room): void {
    if (now < player.nextShotAt || player.reloading || player.ammo <= 0) return;
    player.ammo--; player.nextShotAt = now + FIRE_INTERVAL * 1000 * (player.isBot ? 2.8 : 1);
    const from = { x: player.x, y: player.y + (player.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT), z: player.z };
    const direction = lookDirection(player.yaw, player.pitch);
    let distance = rayMap(from, direction), victim: ServerPlayer | undefined;
    for (const other of room.players.values()) {
      if (other.id === player.id || other.health <= 0) continue;
      const height = other.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
      const hit = rayBox(from, direction,
        { x: other.x - PLAYER_RADIUS, y: other.y, z: other.z - PLAYER_RADIUS },
        { x: other.x + PLAYER_RADIUS, y: other.y + height, z: other.z + PLAYER_RADIUS });
      if (hit !== null && hit < distance) { victim = other; distance = hit; }
    }
    const to = { x: from.x + direction.x * distance, y: from.y + direction.y * distance, z: from.z + direction.z * distance };
    const headshot = victim ? to.y > victim.y + (victim.crouching ? .75 : 1.3) : false;
    addEvent(room, { type: 'shot', playerId: player.id, from, to, hitPlayerId: victim?.id, headshot });
    if (!victim) return;
    const amount = headshot ? 68 : 34;
    victim.health = Math.max(0, victim.health - amount);
    addEvent(room, { type: 'damage', playerId: victim.id, attackerId: player.id, amount, headshot });
    if (victim.health <= 0) {
      player.kills++; player.score += headshot ? 125 : 100; victim.deaths++;
      victim.respawnAt = now + RESPAWN_SECONDS * 1000; victim.vx = victim.vy = victim.vz = 0;
      victim.reloading = false; victim.reloadAt = 0;
      addEvent(room, { type: 'kill', killerId: player.id, victimId: victim.id, killerName: player.name, victimName: victim.name });
    }
  }
  function step(): void {
    now += STEP * 1000; tick++;
    for (const room of rooms.values()) {
      const humans = [...room.players.values()].filter(player => !player.isBot);
      if (!humans.length) {
        if (now - room.lastHumanAt > 30_000) rooms.delete(room.name);
        continue;
      }
      if (now >= room.endsAt) {
        const winner = [...room.players.values()].sort((a, b) => b.score - a.score)[0];
        room.endsAt = now + (options.matchSeconds ?? MATCH_SECONDS) * 1000;
        addEvent(room, { type: 'match', message: `${winner?.name ?? 'Nobody'} wins. New round!` });
        for (const player of room.players.values()) {
          player.kills = player.deaths = player.score = 0; respawn(player, room);
        }
      }
      for (const player of room.players.values()) {
        if (player.health <= 0) { if (now >= player.respawnAt) respawn(player, room); else continue; }
        if (player.isBot) player.input = botInput(player, room);
        const input = now - player.lastInputAt > 300 && !player.isBot
          ? { ...player.input, forward: 0, strafe: 0, jump: false, fire: false, reload: false } : player.input;
        player.yaw = input.yaw; player.pitch = input.pitch; player.ackSeq = input.seq;
        movePlayer(player, input, STEP);
        if (player.reloading && now >= player.reloadAt) {
          player.reloading = false; player.ammo = MAGAZINE_SIZE; player.reloadAt = 0;
        }
        if ((input.reload || (input.fire && player.ammo === 0)) && !player.reloading && player.ammo < MAGAZINE_SIZE) {
          player.reloading = true; player.reloadAt = now + RELOAD_SECONDS * 1000;
        }
        if (input.fire) fire(player, room);
      }
      if (tick % 3 === 0) {
        const message = snapshot(room, room.events.splice(0));
        for (const player of room.players.values()) if (player.socket) send(player.socket, message);
      }
    }
  }
  let previous = performance.now(), accumulator = 0;
  const interval = setInterval(() => {
    const current = performance.now(); accumulator += Math.min(.25, (current - previous) / 1000); previous = current;
    while (accumulator >= STEP) { step(); accumulator -= STEP; }
  }, 1000 / 120);
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if ((!client.id && Date.now() - client.joinedAt > 10_000) || Date.now() - client.lastPongAt > 45_000) client.socket.terminate();
      else client.socket.ping();
    }
  }, 15_000);
  interval.unref(); heartbeat.unref();

  await new Promise<void>((accept, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(options.port ?? 3001, options.host ?? '0.0.0.0', () => {
      server.off('error', rejectPromise); accept();
    });
  }).catch(error => { clearInterval(interval); clearInterval(heartbeat); throw error; });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port ?? 3001;
  return {
    server, wss, port,
    async close(): Promise<void> {
      clearInterval(interval); clearInterval(heartbeat);
      for (const client of clients) client.socket.terminate();
      await new Promise<void>(accept => wss.close(() => accept()));
      await new Promise<void>((accept, rejectPromise) => server.close(error => error ? rejectPromise(error) : accept()));
      rooms.clear();
    },
  };
}
