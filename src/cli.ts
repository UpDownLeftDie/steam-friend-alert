/**
Steam Friend Activity Alerts

Polls the Steam Web API for a list of friends and sends a notification
(ntfy, Discord, webhook, Pushover, or Gotify) when one of them starts
playing a game (optionally filtered via gameFilter include/exclude lists).

Setup: see README.md
*/

import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnvironment, parseConfig, parseState } from './config.ts';
import { pollOnce } from './poll.ts';
import type { Config, State } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH =
  process.env.CONFIG_PATH ?? path.join(__dirname, '..', 'config.json');
const STATE_PATH =
  process.env.STATE_PATH ?? path.join(__dirname, '..', 'state.json');

async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return parseConfig(JSON.parse(raw));
  } catch (error) {
    if (isEnoent(error)) {
      return configFromEnvironment(process.env);
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    !!error &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function loadState(): Promise<State> {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return parseState(JSON.parse(raw));
  } catch {
    return { players: {} };
  }
}

async function saveState(state: State): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, undefined, 2));
}

function startHealthServer(): void {
  const port = process.env.PORT;
  if (!port) return;
  createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok\n');
  }).listen(Number(port), () => {
    console.log(`[health] listening on :${port}`);
  });
}

function shouldRunOnce(): boolean {
  return (
    process.argv.includes('--once') ||
    process.env.POLL_ONCE === '1' ||
    process.env.POLL_ONCE === 'true'
  );
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const state = await loadState();
  const isOnce = shouldRunOnce();
  const friendCount = new Set(config.watches.map((w) => w.steamId)).size;
  const pollLabel = isOnce
    ? ' (single poll).'
    : `, polling every ${config.pollIntervalMinutes} min.`;
  const notificationTypes = config.notifications.map((n) => n.type).join(', ');

  console.log(
    `Watching ${friendCount} friend(s)${pollLabel} Notifications: ${notificationTypes}.`,
  );

  const runPoll = async () => {
    try {
      await pollOnce(config, state, saveState);
    } catch (error) {
      console.error(
        'Poll failed:',
        error instanceof Error ? error.message : error,
      );
    }
  };

  await runPoll();
  if (isOnce) return;

  startHealthServer();
  setInterval(runPoll, config.pollIntervalMinutes * 60 * 1000);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
