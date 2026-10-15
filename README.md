# DRIFT

A multiplayer browser arena shooter built with Three.js, TypeScript, and WebSockets. Fast acceleration, retained air momentum, automatic bunny hopping, and slides give it a Krunker-inspired movement feel. The original sandstone arena has raised lanes, rooftops, cargo cover, and a single automatic rifle.

## Run locally

Use Node.js 22.12 or newer, then:

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. This starts the Vite client on port **5173** and the game server on **3001** by default. An existing `PORT` or `GAME_SERVER_PORT` environment variable changes the game port; Vite automatically proxies `/ws` and `/health` to that port. Join the same room from another browser or computer to play together. Bots keep a small match active when you are alone; the scoreboard identifies them.

The dev server listens on `0.0.0.0`, so another computer on your network can open `http://YOUR-LAN-IP:5173`. Allow the port through your firewall if necessary. Use the game's room link to share a room. Remote friends need a public HTTPS deployment or tunnel that also supports WebSocket upgrades.

```sh
npm run build
npm start
```

The production server serves `dist/` and `/ws` together at **http://localhost:3001** by default. Set `GAME_SERVER_PORT` or `PORT` to change the game server port (`GAME_SERVER_PORT` takes precedence); use HTTPS with WebSocket upgrades in your public reverse proxy. `npm run typecheck` checks TypeScript and `npm test` runs the movement/server checks.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look |
| W / A / S / D | Move |
| Space | Jump; hold to bunny hop |
| Shift | Slide while moving |
| Left mouse | Fire |
| Right mouse | Aim |
| R | Reload |
| Tab | Scoreboard |
| Esc | Release mouse / menu |

Click into the game to capture the mouse. The current game targets desktop browsers with a keyboard and mouse.

## Multiplayer architecture

- `shared/game.ts` defines movement, map colliders, weapon constants, and the typed wire protocol. The client predicts movement with the same simulation as the server and reconciles against acknowledged input; remote players render between snapshots.
- `server/game-server.ts` owns rooms and runs a **60 Hz authoritative simulation**, sending **20 Hz snapshots**; `server/index.ts` starts the HTTP/WebSocket service. The server decides movement, world collision, hitscan line of sight, damage, ammunition, reloads, scores, and respawns. Clients send inputs rather than positions or hit claims.
- Rooms support **eight human players**, with up to **three server-controlled bots** filling spare slots. Five-minute free-for-all rounds reset automatically. Deaths respawn after 2.5 seconds. Empty rooms are cleaned up.
- Names and room keys are sanitized. Messages are capped at 4 KB, inputs are rate limited, and WebSocket heartbeats clean up lost connections. This prototype has no persistent accounts, matchmaking service, or server-side rewind for lag compensation.
- `src/platform.ts` isolates the optional Discord adapter and endpoint selection from the game. Browser play does not initialize the Discord SDK.

## Prepare a Discord Activity

The adapter already detects Discord's iframe parameters, waits up to four seconds for the Embedded App SDK to become ready, and derives a stable room key from the Activity `instanceId` (with a channel fallback). Players joining the same Activity therefore select the same room. A missing client ID or failed SDK handshake falls back to browser mode with a visible status label and a console warning.

This provides Activity bootstrapping and room routing. Discord OAuth, verified user identity, backend authorization, Activity publishing, and production deployment remain future work. Room identifiers are routing hints, not authentication. User names currently remain player-entered guest names.

1. Copy `.env.example` to `.env.local` and set `VITE_DISCORD_CLIENT_ID` to your Discord application's public client ID. Leave `VITE_WS_URL` empty for the default shared origin. Restart dev or rebuild after changing environment variables. Never put a client secret in a `VITE_` variable; these values are public browser code.
2. Build and start the game, then expose port 3001 through an HTTPS tunnel with WebSocket support. For example, if Cloudflare Tunnel is installed:

   ```sh
   npm run build
   npm start
   # In a second terminal:
   cloudflared tunnel --url http://localhost:3001
   ```

3. In the [Discord Developer Portal](https://discord.com/developers/applications), enable Activities, select the supported desktop/web platforms, and map the `/` URL prefix to the tunnel or deployed host. The target is a hostname without `https://`. Both the app and `/ws` must reach the same server through that mapping.
4. Launch through your Developer Activity Shelf, then have another participant join the same Activity. On a Discord proxy origin the client connects to `wss://YOUR-CLIENT-ID.discordsays.com/.proxy/ws`; Discord forwards that mapped request to your server's `/ws`. In an ordinary browser or direct local URL override it uses same-origin `/ws`.

`VITE_WS_URL` optionally overrides the endpoint with a `ws://` / `wss://` URL or a relative path. For a Discord Activity use a mapped path on the Activity's own proxy origin, such as `/.proxy/ws`; arbitrary external WebSockets are blocked by Discord's network policy. There is no global network monkey patching in this project.

See Discord's official [local development and URL mapping guide](https://docs.discord.com/developers/activities/development-guides/local-development), [networking guide](https://docs.discord.com/developers/activities/development-guides/networking), [instance management guide](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience), and [Embedded App SDK](https://github.com/discord/embedded-app-sdk). Discord supports proxied WebSockets; WebRTC is unavailable in Activities. Recheck the mappings and SDK handshake inside Discord before publishing.
