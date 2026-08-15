/**
 * Steam Friend Activity Alerts
 *
 * Polls the Steam Web API for a list of friends and sends an ntfy push
 * notification when one of them starts playing a game (optionally scoped
 * to specific games per watch entry).
 *
 * Setup: see README.md
 */

import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configFromEnv, parseConfig, parseState } from "./config.ts";
import { pollOnce } from "./poll.ts";
import type { Config, State } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH =
	process.env.CONFIG_PATH ?? path.join(__dirname, "..", "config.json");
const STATE_PATH =
	process.env.STATE_PATH ?? path.join(__dirname, "..", "state.json");

async function loadConfig(): Promise<Config> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf-8");
		return parseConfig(JSON.parse(raw));
	} catch (err) {
		if (isEnoent(err)) {
			return configFromEnv(process.env);
		}
		throw err;
	}
}

function isEnoent(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		err.code === "ENOENT"
	);
}

async function loadState(): Promise<State> {
	try {
		const raw = await readFile(STATE_PATH, "utf-8");
		return parseState(JSON.parse(raw));
	} catch {
		return { lastCheckedAt: null, players: {} };
	}
}

async function saveState(state: State): Promise<void> {
	await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function startHealthServer(): void {
	const port = process.env.PORT;
	if (!port) return;
	createServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
		res.end("ok\n");
	}).listen(Number(port), () => {
		console.log(`[health] listening on :${port}`);
	});
}

function wantsOnce(): boolean {
	return (
		process.argv.includes("--once") ||
		process.env.POLL_ONCE === "1" ||
		process.env.POLL_ONCE === "true"
	);
}

async function main(): Promise<void> {
	const config = await loadConfig();
	const state = await loadState();
	const once = wantsOnce();

	console.log(
		`Watching ${new Set(config.watches.map((w) => w.steamId)).size} friend(s)${once ? " (single poll)." : `, polling every ${config.pollIntervalMinutes} min.`}`,
	);

	const runPoll = async () => {
		try {
			await pollOnce(config, state, saveState);
		} catch (err) {
			console.error("Poll failed:", err instanceof Error ? err.message : err);
		}
	};

	await runPoll();
	if (once) return;

	startHealthServer();
	setInterval(runPoll, config.pollIntervalMinutes * 60 * 1000);
}

try {
	await main();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
