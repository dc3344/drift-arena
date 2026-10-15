import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_INPUT, MAP_COLLIDERS, createPlayerState, lookDirection, movePlayer, rayBox, rayMap,
} from '../shared/game.js';

test('shared movement runs deterministically, blocks walls, and preserves airborne momentum', () => {
  const a = createPlayerState({ x: 0, y: 0, z: 25 });
  const b = createPlayerState({ x: 0, y: 0, z: 25 });
  const input = { ...EMPTY_INPUT, forward: 1, sprint: true };
  for (let i = 0; i < 60; i++) { movePlayer(a, input, 1 / 60); movePlayer(b, input, 1 / 60); }
  assert.deepEqual(a, b);
  assert.ok(a.z < 17, 'running crosses the start lane');
  const before = Math.hypot(a.vx, a.vz);
  movePlayer(a, { ...input, jump: true }, 1 / 60);
  assert.ok(a.y > 0 && !a.grounded);
  for (let i = 0; i < 10; i++) movePlayer(a, EMPTY_INPUT, 1 / 60);
  assert.ok(Math.hypot(a.vx, a.vz) >= before - .01, 'air momentum survives releasing movement');

  const wall = createPlayerState({ x: 25, y: 0, z: 0 });
  for (let i = 0; i < 180; i++) movePlayer(wall, { ...input, yaw: -Math.PI / 2 }, 1 / 60);
  assert.ok(wall.x <= 27.161 && wall.x > 27, 'perimeter remains solid');
});

test('central stairs and roof stairs can be climbed without jumping', () => {
  const central = createPlayerState({ x: -8, y: 0, z: 0 });
  for (let i = 0; i < 65; i++) movePlayer(central, { ...EMPTY_INPUT, forward: 1, yaw: -Math.PI / 2 }, 1 / 60);
  assert.ok(central.y > 1.3, 'central crossing is reachable');
  const roof = createPlayerState({ x: -16, y: 0, z: 15 });
  for (let i = 0; i < 145; i++) movePlayer(roof, { ...EMPTY_INPUT, forward: 1 }, 1 / 60);
  assert.ok(roof.y > 4.1, `roof is reachable; y=${roof.y}`);
});

test('ray intersections stop at physical cover and use the same yaw as movement', () => {
  assert.deepEqual(lookDirection(0, 0), { x: -0, y: 0, z: -1 });
  const direction = lookDirection(-Math.PI / 2, 0);
  const wallDistance = rayMap({ x: -23, y: 1.56, z: -5 }, direction);
  assert.ok(Math.abs(wallDistance - 3) < .01, 'west depot blocks shots');
  assert.equal(rayBox({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: -1 },
    { x: -1, y: 0, z: -4 }, { x: 1, y: 1, z: -2 }), null);
  assert.ok(MAP_COLLIDERS.every(box => box.w > 0 && box.h > 0 && box.d > 0));
});

test('sprinting into crouch produces a temporary momentum slide', () => {
  const player = createPlayerState({ x: 0, y: 0, z: 25 });
  const run = { ...EMPTY_INPUT, forward: 1, sprint: true };
  for (let i = 0; i < 35; i++) movePlayer(player, run, 1 / 60);
  const oldSpeed = Math.hypot(player.vx, player.vz);
  movePlayer(player, { ...run, crouch: true }, 1 / 60);
  assert.ok(player.crouching && player.slideTimer > .6);
  assert.ok(Math.hypot(player.vx, player.vz) > oldSpeed);
});
