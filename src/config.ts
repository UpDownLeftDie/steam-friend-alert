import {
  type Config,
  DEFAULT_GOTIFY_PRIORITY,
  DEFAULT_NTFY_URL,
  DEFAULT_POLL_INTERVAL_MINUTES,
  DEFAULT_STALE_AFTER_MINUTES,
  type EnvLike,
  type NotificationTarget,
  type State,
  type Watch,
} from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${field} must be an http(s) URL`);
  }
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return value.slice(0, end);
}

function parseWatch(value: unknown, index: number): Watch {
  if (!isRecord(value) || typeof value.steamId !== 'string' || !value.steamId) {
    throw new Error(`watches[${index}] must include a steamId string`);
  }
  const watch: Watch = { steamId: value.steamId };
  if (value.label !== undefined) {
    if (typeof value.label !== 'string') {
      throw new TypeError(`watches[${index}].label must be a string`);
    }
    watch.label = value.label;
  }
  if (value.gameNames !== undefined) {
    if (
      !Array.isArray(value.gameNames) ||
      value.gameNames.some((name) => typeof name !== 'string')
    ) {
      throw new Error(`watches[${index}].gameNames must be a string array`);
    }
    watch.gameNames = value.gameNames;
  }
  return watch;
}

function parseOptionalNumber(
  value: unknown,
  field: string,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return parsed;
}

function parseGotifyPriority(value: unknown): number {
  if (value === undefined || value === '') return DEFAULT_GOTIFY_PRIORITY;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    throw new Error('gotify priority must be an integer from 0 to 10');
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`${field} is required`);
  return parsed;
}

function parseNotification(value: unknown, index: number): NotificationTarget {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`notifications[${index}] must include a type`);
  }
  const prefix = `notifications[${index}]`;
  switch (value.type) {
    case 'ntfy':
      return {
        type: 'ntfy',
        topic: requireString(value.topic, `${prefix}.topic`),
        url: optionalString(value.url) || DEFAULT_NTFY_URL,
        token: optionalString(value.token),
      };
    case 'discord': {
      const webhookUrl = requireString(value.webhookUrl, `${prefix}.webhookUrl`);
      return {
        type: 'discord',
        webhookUrl: requireHttpUrl(webhookUrl, `${prefix}.webhookUrl`),
      };
    }
    case 'webhook': {
      const url = requireString(value.url, `${prefix}.url`);
      return {
        type: 'webhook',
        url: requireHttpUrl(url, `${prefix}.url`),
        authorization: optionalString(value.authorization),
      };
    }
    case 'pushover':
      return {
        type: 'pushover',
        userKey: requireString(value.userKey, `${prefix}.userKey`),
        apiToken: requireString(value.apiToken, `${prefix}.apiToken`),
      };
    case 'gotify': {
      const url = requireString(value.url, `${prefix}.url`);
      return {
        type: 'gotify',
        url: requireHttpUrl(url, `${prefix}.url`),
        token: requireString(value.token, `${prefix}.token`),
        priority: parseGotifyPriority(value.priority),
      };
    }
    default:
      throw new Error(`${prefix}: unknown type "${value.type}"`);
  }
}

export function parseConfig(raw: unknown): Config {
  if (!isRecord(raw)) {
    throw new Error('Config must be a JSON object');
  }

  const steamApiKey =
    typeof raw.steamApiKey === 'string' ? raw.steamApiKey.trim() : '';
  if (!steamApiKey || steamApiKey === 'YOUR_STEAM_API_KEY') {
    throw new Error(
      'Set steamApiKey (get one at https://steamcommunity.com/dev/apikey)',
    );
  }

  if (!Array.isArray(raw.watches) || raw.watches.length === 0) {
    throw new Error('Add at least one entry to watches');
  }

  if (!Array.isArray(raw.notifications) || raw.notifications.length === 0) {
    throw new Error(
      'Add at least one notification (ntfy, discord, webhook, pushover, or gotify)',
    );
  }
  const notifications: NotificationTarget[] = raw.notifications.map(
    (value, index) => parseNotification(value, index),
  );

  return {
    steamApiKey,
    notifications,
    pollIntervalMinutes: parseOptionalNumber(
      raw.pollIntervalMinutes,
      'pollIntervalMinutes',
      DEFAULT_POLL_INTERVAL_MINUTES,
    ),
    staleAfterMinutes: parseOptionalNumber(
      raw.staleAfterMinutes,
      'staleAfterMinutes',
      DEFAULT_STALE_AFTER_MINUTES,
    ),
    watches: raw.watches.map((value, index) => parseWatch(value, index)),
  };
}

function parseNotificationsJson(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new TypeError('NOTIFICATIONS must be a JSON array');
    }
    return parsed;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('NOTIFICATIONS')) {
      throw err;
    }
    throw new Error('NOTIFICATIONS must be valid JSON');
  }
}

export function configFromEnv(env: EnvLike): Config {
  let watches: unknown = env.WATCHES;
  if (typeof watches === 'string') {
    try {
      watches = JSON.parse(watches);
    } catch {
      throw new Error('WATCHES must be valid JSON');
    }
  }

  if (!env.NOTIFICATIONS) {
    throw new Error(
      'Set NOTIFICATIONS to a JSON array of notification targets',
    );
  }

  return parseConfig({
    steamApiKey: env.STEAM_API_KEY,
    notifications: parseNotificationsJson(env.NOTIFICATIONS),
    pollIntervalMinutes: env.POLL_INTERVAL_MINUTES,
    staleAfterMinutes: env.STALE_AFTER_MINUTES,
    watches,
  });
}

function toPlayerMap(raw: Record<string, unknown>): Record<string, string | null> {
  const players: Record<string, string | null> = {};
  for (const [steamId, game] of Object.entries(raw)) {
    players[steamId] = typeof game === 'string' ? game : null;
  }
  return players;
}

export function parseState(raw: unknown): State {
  if (!raw) {
    return { lastCheckedAt: null, players: {} };
  }
  if (isRecord(raw) && 'players' in raw && isRecord(raw.players)) {
    return {
      lastCheckedAt:
        typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : null,
      players: toPlayerMap(raw.players),
    };
  }
  if (isRecord(raw)) {
    return { lastCheckedAt: null, players: toPlayerMap(raw) };
  }
  return { lastCheckedAt: null, players: {} };
}
