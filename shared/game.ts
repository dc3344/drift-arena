/** Shared, deterministic movement and wire contracts. Player positions are feet. */
export interface Vec3 { x: number; y: number; z: number }
export interface Collider extends Vec3 {
  id: string; w: number; h: number; d: number; color: number;
  kind?: 'wall' | 'building' | 'crate' | 'container' | 'step';
}
export interface PlayerInput {
  seq: number; forward: number; strafe: number; jump: boolean; crouch: boolean;
  sprint: boolean; yaw: number; pitch: number; fire: boolean; reload: boolean;
}
export interface PlayerState extends Vec3 {
  vx: number; vy: number; vz: number; grounded: boolean; crouching: boolean;
  slideTimer: number; slideCooldown: number;
}
export interface PublicPlayer extends PlayerState {
  id: string; name: string; color: number; isBot: boolean; yaw: number; pitch: number;
  health: number; ammo: number; reloading: boolean; respawnAt: number;
  score: number; kills: number; deaths: number; ackSeq: number;
}
export type GameEvent =
  | { id: number; type: 'shot'; playerId: string; from: Vec3; to: Vec3; hitPlayerId?: string; headshot?: boolean }
  | { id: number; type: 'kill'; killerId: string; victimId: string; killerName: string; victimName: string }
  | { id: number; type: 'damage'; playerId: string; attackerId: string; amount: number; headshot: boolean }
  | { id: number; type: 'match'; message: string };
export interface GameSnapshot {
  type: 'snapshot'; tick: number; serverTime: number; room: string;
  timeLeft: number; players: PublicPlayer[]; events: GameEvent[];
}
export type ClientMessage = { type: 'join'; name: string; room: string }
  | ({ type: 'input' } & PlayerInput) | { type: 'ping'; at: number };
export type ServerMessage = GameSnapshot | { type: 'joined'; id: string; room: string }
  | { type: 'error'; message: string } | { type: 'pong'; at: number };

export const ARENA_SIZE = 56;
export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.75;
export const CROUCH_HEIGHT = 1.05;
export const EYE_HEIGHT = 1.56;
export const CROUCH_EYE_HEIGHT = 0.92;
export const MAGAZINE_SIZE = 24;
export const RELOAD_SECONDS = 1.35;
export const RELOAD_TIME = RELOAD_SECONDS;
export const MATCH_SECONDS = 300;
export const RESPAWN_SECONDS = 2.5;
export const FIRE_INTERVAL = 0.115;
export const EMPTY_INPUT: PlayerInput = {
  seq: 0, forward: 0, strafe: 0, jump: false, crouch: false, sprint: false,
  yaw: 0, pitch: 0, fire: false, reload: false,
};

const c = (id: string, x: number, y: number, z: number, w: number, h: number, d: number,
  color: number, kind: Collider['kind'] = 'building'): Collider => ({ id, x, y, z, w, h, d, color, kind });

/** Warm sandstone, painted cargo containers, and a central raised crossing. */
export const MAP_COLLIDERS: Collider[] = [
  c('north-wall', 0, 2.5, -28, 57, 5, 1, 0xbaa587, 'wall'),
  c('south-wall', 0, 2.5, 28, 57, 5, 1, 0xbaa587, 'wall'),
  c('west-wall', -28, 2.5, 0, 1, 5, 55, 0xc8b294, 'wall'),
  c('east-wall', 28, 2.5, 0, 1, 5, 55, 0xc8b294, 'wall'),
  c('west-depot', -16, 2.1, -5, 8, 4.2, 12, 0xc5ad88),
  c('east-depot', 16, 2.1, 5, 8, 4.2, 12, 0xd0b896),
  c('north-office', 6, 1.6, -20, 10, 3.2, 6, 0xcab798),
  c('south-office', -6, 1.6, 20, 10, 3.2, 6, 0xcab798),
  c('bridge', 0, 0.7, 0, 6, 1.4, 11, 0xb5a387),
  c('blue-container', -8.5, 1.3, 10, 3, 2.6, 7, 0x496b76, 'container'),
  c('red-container', 8.5, 1.3, -10, 3, 2.6, 7, 0xa35e49, 'container'),
  c('north-cover', -13, 0.65, -20, 7, 1.3, 1, 0xd4c2a0, 'wall'),
  c('south-cover', 13, 0.65, 20, 7, 1.3, 1, 0xd4c2a0, 'wall'),
  c('west-cover', -23, 0.6, 11, 1, 1.2, 7, 0xcbb695, 'wall'),
  c('east-cover', 23, 0.6, -11, 1, 1.2, 7, 0xcbb695, 'wall'),
  c('crate-a', -6, 0.85, -11, 2, 1.7, 2, 0xa78d66, 'crate'),
  c('crate-b', 6, 0.85, 11, 2, 1.7, 2, 0xa78d66, 'crate'),
  c('crate-c', -21, 0.85, -15, 2, 1.7, 2, 0xa78d66, 'crate'),
  c('crate-d', 21, 0.85, 15, 2, 1.7, 2, 0xa78d66, 'crate'),
  c('crate-e', -19, 0.65, 20, 2.5, 1.3, 2.5, 0x9d865f, 'crate'),
  c('crate-f', 19, 0.65, -20, 2.5, 1.3, 2.5, 0x9d865f, 'crate'),
  // Four broad steps on either side make the elevated central lane playable.
  ...Array.from({ length: 4 }, (_, i) => c(`west-stair-${i}`, -6.5 + i, (i + 1) * .175,
    0, 1, (i + 1) * .35, 5, 0xb5a387, 'step')),
  ...Array.from({ length: 4 }, (_, i) => c(`east-stair-${i}`, 6.5 - i, (i + 1) * .175,
    0, 1, (i + 1) * .35, 5, 0xb5a387, 'step')),
  ...Array.from({ length: 12 }, (_, i) => c(`west-roof-stair-${i}`, -16, (i + 1) * .175,
    12.5 - i, 3, (i + 1) * .35, 1, 0xb5a387, 'step')),
  ...Array.from({ length: 12 }, (_, i) => c(`east-roof-stair-${i}`, 16, (i + 1) * .175,
    -12.5 + i, 3, (i + 1) * .35, 1, 0xb5a387, 'step')),
];
export const MAP_SPAWNS: (Vec3 & { yaw: number })[] = [
  { x: 0, y: 0, z: 25, yaw: 0 },
  { x: -22, y: 0, z: 22, yaw: -Math.PI / 4 },
  { x: 22, y: 0, z: -22, yaw: Math.PI * .75 },
  { x: -22, y: 0, z: -22, yaw: -Math.PI * .75 },
  { x: 22, y: 0, z: 22, yaw: Math.PI / 4 },
  { x: 0, y: 0, z: -25, yaw: Math.PI },
  { x: -25, y: 0, z: 2, yaw: -Math.PI / 2 },
  { x: 25, y: 0, z: -2, yaw: Math.PI / 2 },
];

export function createPlayerState(spawn: Vec3 = MAP_SPAWNS[0]): PlayerState {
  return { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0,
    grounded: spawn.y <= 0, crouching: false, slideTimer: 0, slideCooldown: 0 };
}
function overlaps(state: Vec3, height: number, box: Collider): boolean {
  return state.x + PLAYER_RADIUS > box.x - box.w / 2 && state.x - PLAYER_RADIUS < box.x + box.w / 2
    && state.z + PLAYER_RADIUS > box.z - box.d / 2 && state.z - PLAYER_RADIUS < box.z + box.d / 2
    && state.y + height > box.y - box.h / 2 + .001 && state.y < box.y + box.h / 2 - .001;
}
function moveAxis(state: PlayerState, axis: 'x' | 'z', distance: number, height: number): void {
  state[axis] += distance;
  for (const box of MAP_COLLIDERS) {
    if (!overlaps(state, height, box)) continue;
    const top = box.y + box.h / 2;
    const step = top - state.y;
    if (state.grounded && step > 0 && step <= .38
      && !MAP_COLLIDERS.some(other => other !== box && overlaps({ ...state, y: top + .001 }, height, other))) {
      state.y = top;
      continue;
    }
    const dimension = axis === 'x' ? box.w : box.d;
    state[axis] = box[axis] + (distance > 0 ? -1 : 1) * (dimension / 2 + PLAYER_RADIUS);
    if (axis === 'x') state.vx = 0; else state.vz = 0;
  }
}

/** Quake-inspired acceleration, retained air momentum, auto-hop, and crouch slides. */
export function movePlayer(state: PlayerState, input: PlayerInput, dt: number): void {
  dt = Math.max(0, Math.min(dt, .05));
  state.slideTimer = Math.max(0, state.slideTimer - dt);
  state.slideCooldown = Math.max(0, state.slideCooldown - dt);
  let speed = Math.hypot(state.vx, state.vz);
  if (input.crouch && input.sprint && state.grounded && speed > 6 && state.slideCooldown <= 0) {
    state.slideTimer = .72; state.slideCooldown = 1.1;
    state.vx *= 1.15; state.vz *= 1.15; speed *= 1.15;
  }
  const wantsCrouch = input.crouch || state.slideTimer > 0;
  state.crouching = wantsCrouch || (state.crouching && MAP_COLLIDERS.some(box => overlaps(state, PLAYER_HEIGHT, box)));
  const height = state.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  const jumping = input.jump && state.grounded;
  if (state.grounded && !jumping) {
    const friction = state.slideTimer > 0 ? 1.1 : 8.5;
    const nextSpeed = Math.max(0, speed - Math.max(speed, 3) * friction * dt);
    if (speed > 0) { state.vx *= nextSpeed / speed; state.vz *= nextSpeed / speed; }
  }
  const magnitude = Math.hypot(input.forward, input.strafe);
  if (magnitude > 0) {
    const forward = input.forward / Math.max(1, magnitude), strafe = input.strafe / Math.max(1, magnitude);
    const wishX = -Math.sin(input.yaw) * forward + Math.cos(input.yaw) * strafe;
    const wishZ = -Math.cos(input.yaw) * forward - Math.sin(input.yaw) * strafe;
    const maxSpeed = state.crouching && state.slideTimer <= 0 ? 4 : input.sprint ? 9.8 : 7.5;
    const current = state.vx * wishX + state.vz * wishZ;
    const accel = state.grounded ? (state.slideTimer > 0 ? 12 : 95) : 20;
    const increase = Math.max(0, Math.min(maxSpeed - current, accel * dt));
    state.vx += wishX * increase; state.vz += wishZ * increase;
  }
  speed = Math.hypot(state.vx, state.vz);
  if (speed > 17) { state.vx *= 17 / speed; state.vz *= 17 / speed; }
  if (jumping) { state.vy = 8; state.grounded = false; }
  state.vy -= 24 * dt;
  moveAxis(state, 'x', state.vx * dt, height);
  moveAxis(state, 'z', state.vz * dt, height);
  const oldY = state.y;
  state.y += state.vy * dt;
  state.grounded = false;
  for (const box of MAP_COLLIDERS) {
    if (!overlaps(state, height, box)) continue;
    if (state.vy <= 0 && oldY >= box.y + box.h / 2 - .05) {
      state.y = box.y + box.h / 2; state.vy = 0; state.grounded = true;
    } else if (state.vy > 0 && oldY + height <= box.y - box.h / 2 + .05) {
      state.y = box.y - box.h / 2 - height; state.vy = 0;
    }
  }
  if (state.y <= 0) { state.y = 0; state.vy = 0; state.grounded = true; }
}

export function lookDirection(yaw: number, pitch: number): Vec3 {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}
/** Distance to the first ray/AABB intersection, or null. Direction must be normalized. */
export function rayBox(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3): number | null {
  let near = 0, far = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
    } else {
      let a = (min[axis] - origin[axis]) / direction[axis];
      let b = (max[axis] - origin[axis]) / direction[axis];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return null;
    }
  }
  return far >= 0 ? near : null;
}
export function rayMap(origin: Vec3, direction: Vec3, maxDistance = 100): number {
  let closest = maxDistance;
  for (const box of MAP_COLLIDERS) {
    const hit = rayBox(origin, direction,
      { x: box.x - box.w / 2, y: box.y - box.h / 2, z: box.z - box.d / 2 },
      { x: box.x + box.w / 2, y: box.y + box.h / 2, z: box.z + box.d / 2 });
    if (hit !== null && hit < closest) closest = hit;
  }
  if (direction.y < 0) closest = Math.min(closest, -origin.y / direction.y);
  return closest;
}
