export interface PlatformContext {
  kind: 'browser' | 'discord';
  room?: string;
  name?: string;
  label: string;
}

const SDK_READY_TIMEOUT_MS = 4_000;
let platformContext: Promise<PlatformContext> | undefined;

function isActivityFrame(): boolean {
  return new URLSearchParams(window.location.search).has('frame_id');
}

function isDiscordProxy(): boolean {
  return /\.(discordsays|discordsez)\.com$/i.test(window.location.hostname);
}

// Stable, bounded room keys. This is routing information, never proof of identity
// or permission to enter an Activity. All peers in an instance use the same key.
function roomKey(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `dc-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

async function connectPlatform(): Promise<PlatformContext> {
  if (!isActivityFrame()) return { kind: 'browser', label: 'BROWSER' };

  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();
  if (!clientId) {
    console.warn('[DRIFT] Discord frame detected, but VITE_DISCORD_CLIENT_ID is missing. Continuing in browser mode.');
    return { kind: 'browser', label: 'DISCORD NEEDS SETUP' };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { DiscordSDK } = await import('@discord/embedded-app-sdk');
    const sdk = new DiscordSDK(clientId, { disableConsoleLogOverride: true });
    await Promise.race([
      sdk.ready(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Discord SDK ready timed out after 4 seconds.')), SDK_READY_TIMEOUT_MS);
      }),
    ]);
    const instance = sdk.instanceId || sdk.channelId;
    if (!instance) throw new Error('Discord did not provide an Activity instance or channel.');
    return { kind: 'discord', room: roomKey(instance), label: 'DISCORD ACTIVITY' };
  } catch (error) {
    console.warn('[DRIFT] Discord setup failed. Continuing in browser mode.', error);
    return { kind: 'browser', label: 'DISCORD UNAVAILABLE' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Ordinary browser sessions never import or initialize the Discord SDK. */
export function getPlatformContext(): Promise<PlatformContext> {
  platformContext ??= connectPlatform();
  return platformContext;
}

/** Keep game HTTP and WebSocket traffic behind one origin / Discord mapping. */
export function getWebSocketUrl(): string {
  const fallbackPath = isDiscordProxy() ? '/.proxy/ws' : '/ws';
  const configured = import.meta.env.VITE_WS_URL?.trim();
  try {
    const url = new URL(configured || fallbackPath, window.location.origin);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error('VITE_WS_URL must be a ws/wss URL or an HTTP-relative path.');
    }
    return url.toString();
  } catch (error) {
    console.warn('[DRIFT] Invalid VITE_WS_URL. Using the same-origin game server.', error);
    const url = new URL(fallbackPath, window.location.origin);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }
}
