import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createGameServer, normalizeName, normalizeRoom } from '../server/game-server.js';
import { EMPTY_INPUT, type GameSnapshot, type PlayerInput, type ServerMessage } from '../shared/game.js';

interface TestClient {
  socket: WebSocket; messages: ServerMessage[]; sequence: number;
  next: <T extends ServerMessage>(predicate: (message: ServerMessage) => message is T, timeout?: number) => Promise<T>;
}
async function connect(port: number, room: string, name = 'Runner'): Promise<TestClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString()) as ServerMessage));
  const next = async <T extends ServerMessage>(predicate: (message: ServerMessage) => message is T, timeout = 2500): Promise<T> => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0] as T;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for server message');
  };
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'join', room, name }));
  return { socket, messages, next, sequence: 0 };
}
const isSnapshot = (message: ServerMessage): message is GameSnapshot => message.type === 'snapshot';
async function streamInput(client: TestClient, input: Partial<PlayerInput>, duration: number) {
  const started = Date.now();
  while (Date.now() - started < duration) {
    client.socket.send(JSON.stringify({ type: 'input', ...EMPTY_INPUT, ...input, seq: ++client.sequence }));
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('server joins, normalizes identity, isolates rooms, and echoes latency pings', async () => {
  const game = await createGameServer({ port: 0, host: '127.0.0.1', botsPerRoom: 0 });
  try {
    const a = await connect(game.port, 'My ROOM!', '  <Ada>  ');
    const b = await connect(game.port, 'another');
    const joined = await a.next((message): message is Extract<ServerMessage, { type: 'joined' }> => message.type === 'joined');
    assert.equal(joined.room, 'myroom');
    const snapshot = await a.next(isSnapshot);
    assert.equal(snapshot.players.length, 1); assert.equal(snapshot.players[0].name, 'Ada');
    assert.equal((await b.next(isSnapshot)).players.length, 1);
    a.socket.send(JSON.stringify({ type: 'ping', at: 123 }));
    const pong = await a.next((message): message is Extract<ServerMessage, { type: 'pong' }> => message.type === 'pong');
    assert.equal(pong.at, 123);
    const health = await fetch(`http://127.0.0.1:${game.port}/health`).then(response => response.json()) as { ok: boolean; rooms: number };
    assert.ok(health.ok); assert.equal(health.rooms, 2);
    assert.equal(normalizeRoom(''), 'public'); assert.equal(normalizeName('\u0000'), 'Runner');
  } finally { await game.close(); }
});

test('server owns movement and clamps forged input magnitudes', async () => {
  const game = await createGameServer({ port: 0, host: '127.0.0.1', botsPerRoom: 0 });
  try {
    const client = await connect(game.port, 'movement');
    await client.next(isSnapshot);
    await streamInput(client, { forward: 100, sprint: true }, 350);
    const snapshot = await client.next((message): message is GameSnapshot => isSnapshot(message) && message.players[0].z < 23);
    const player = snapshot.players[0];
    assert.ok(player.z > 20, `authoritative movement stays plausible: ${player.z}`);
    assert.ok(player.ackSeq > 0);
    client.socket.send(JSON.stringify({ type: 'input', ...EMPTY_INPUT, seq: 999, yaw: null, x: 99999 }));
    const later = await client.next((message): message is GameSnapshot => isSnapshot(message) && message.tick > snapshot.tick);
    assert.ok(Number.isFinite(later.players[0].x));
    assert.ok(later.players[0].x < 1);
  } finally { await game.close(); }
});

test('authoritative hitscan scores a headshot kill and reload consumes server time', async () => {
  const game = await createGameServer({ port: 0, host: '127.0.0.1', botsPerRoom: 0,
    spawnPoints: [{ x: 0, y: 0, z: 24, yaw: 0 }, { x: 0, y: 0, z: 20, yaw: Math.PI }] });
  try {
    const shooter = await connect(game.port, 'combat', 'Ace');
    const target = await connect(game.port, 'combat', 'Target');
    await shooter.next(isSnapshot); await target.next(isSnapshot);
    await streamInput(shooter, { fire: true }, 600);
    const killed = await shooter.next((message): message is GameSnapshot => isSnapshot(message)
      && message.players.some(player => player.name === 'Target' && player.health === 0));
    const ace = killed.players.find(player => player.name === 'Ace')!;
    const victim = killed.players.find(player => player.name === 'Target')!;
    assert.equal(ace.kills, 1); assert.equal(ace.score, 125); assert.equal(victim.deaths, 1);
    assert.ok(victim.respawnAt > killed.serverTime);
    assert.ok(killed.events.some(event => event.type === 'kill'));
    assert.ok(ace.ammo < 24);
    await streamInput(shooter, { reload: true }, 150);
    const loading = await shooter.next((message): message is GameSnapshot => isSnapshot(message)
      && message.players.some(player => player.name === 'Ace' && player.reloading));
    assert.ok(loading.players.find(player => player.name === 'Ace')!.ammo < 24);
    await shooter.next((message): message is GameSnapshot => isSnapshot(message)
      && message.serverTime > loading.serverTime + 1200
      && message.players.some(player => player.name === 'Ace' && !player.reloading && player.ammo === 24));
    const revived = await target.next((message): message is GameSnapshot => isSnapshot(message)
      && message.serverTime > victim.respawnAt
      && message.players.some(player => player.name === 'Target' && player.health === 100));
    assert.equal(revived.players.find(player => player.name === 'Target')!.deaths, 1);
  } finally { await game.close(); }
});

test('solid cover prevents multiplayer damage', async () => {
  const game = await createGameServer({ port: 0, host: '127.0.0.1', botsPerRoom: 0,
    spawnPoints: [{ x: -23, y: 0, z: -5, yaw: -Math.PI / 2 }, { x: -8, y: 0, z: -5, yaw: 0 }] });
  try {
    const shooter = await connect(game.port, 'cover');
    const target = await connect(game.port, 'cover', 'Covered');
    await shooter.next(isSnapshot); await target.next(isSnapshot);
    await streamInput(shooter, { fire: true, yaw: -Math.PI / 2 }, 700);
    const snapshot = await shooter.next((message): message is GameSnapshot => isSnapshot(message)
      && message.players.some(player => player.ammo < 24));
    assert.equal(snapshot.players.find(player => player.name === 'Covered')!.health, 100);
  } finally { await game.close(); }
});

test('human joins replace labeled practice bots and the room enforces capacity', async () => {
  const game = await createGameServer({ port: 0, host: '127.0.0.1', maxPlayersPerRoom: 2 });
  try {
    const first = await connect(game.port, 'capacity');
    const initial = await first.next(isSnapshot);
    assert.equal(initial.players.length, 2);
    assert.equal(initial.players.filter(player => player.isBot).length, 1);
    const second = await connect(game.port, 'capacity');
    const joined = await second.next(isSnapshot);
    assert.equal(joined.players.length, 2);
    assert.ok(joined.players.every(player => !player.isBot));
    const third = await connect(game.port, 'capacity');
    const error = await third.next((message): message is Extract<ServerMessage, { type: 'error' }> => message.type === 'error');
    assert.match(error.message, /full/i);
  } finally { await game.close(); }
});

test('round timer resets the match and repeated malformed inputs close the connection', async () => {
  const game = await createGameServer({ port: 0, host: '127.0.0.1', botsPerRoom: 0, matchSeconds: .6 });
  try {
    const client = await connect(game.port, 'round');
    const round = await client.next((message): message is GameSnapshot => isSnapshot(message)
      && message.events.some(event => event.type === 'match'));
    assert.ok(round.timeLeft > .5);
    assert.equal(round.players[0].health, 100); assert.equal(round.players[0].score, 0);
    const closed = once(client.socket, 'close');
    for (let i = 0; i < 5; i++) client.socket.send('{invalid');
    const [code] = await closed;
    assert.equal(code, 1008);
  } finally { await game.close(); }
});
