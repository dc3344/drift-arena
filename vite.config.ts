import { defineConfig } from 'vite';

const gamePort = process.env.GAME_SERVER_PORT ?? process.env.PORT ?? '3001';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${gamePort}`, ws: true },
      '/health': { target: `http://127.0.0.1:${gamePort}` },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: (id: string) => id.includes('/three/') ? 'three' : undefined } },
  },
});
