import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './game-server.js';

export { createGameServer } from './game-server.js';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawPort = Number(process.env.GAME_SERVER_PORT ?? process.env.PORT ?? 3001);
  const game = await createGameServer({
    port: Number.isInteger(rawPort) && rawPort >= 0 && rawPort <= 65535 ? rawPort : 3001,
    host: process.env.HOST ?? '0.0.0.0',
    staticDir: resolve(process.cwd(), 'dist'),
  });
  console.log(`DRIFT multiplayer server listening on http://localhost:${game.port}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void game.close().finally(() => process.exit(0)); });
  }
}
