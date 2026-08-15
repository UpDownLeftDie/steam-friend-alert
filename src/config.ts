import {
	type Config,
	DEFAULT_NTFY_URL,
	DEFAULT_POLL_INTERVAL_MINUTES,
	DEFAULT_STALE_AFTER_MINUTES,
	type EnvLike,
	type State,
	type Watch,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWatch(value: unknown, index: number): Watch {
	if (!isRecord(value) || typeof value.steamId !== "string" || !value.steamId) {
		throw new Error(`watches[${index}] must include a steamId string`);
	}
	const watch: Watch = { steamId: value.steamId };
	if (value.label !== undefined) {
		if (typeof value.label !== "string") {
			throw new Error(`watches[${index}].label must be a string`);
		}
		watch.label = value.label;
	}
	if (value.gameNames !== undefined) {
		if (
			!Array.isArray(value.gameNames) ||
			value.gameNames.some((name) => typeof name !== "string")
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
	if (value === undefined || value === "") return fallback;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${field} must be a positive number`);
	}
	return parsed;
}

export function parseConfig(raw: unknown): Config {
	if (!isRecord(raw)) {
		throw new Error("Config must be a JSON object");
	}

	const steamApiKey =
		typeof raw.steamApiKey === "string" ? raw.steamApiKey.trim() : "";
	if (!steamApiKey || steamApiKey === "YOUR_STEAM_API_KEY") {
		throw new Error(
			"Set steamApiKey (get one at https://steamcommunity.com/dev/apikey)",
		);
	}

	const ntfyTopic =
		typeof raw.ntfyTopic === "string" ? raw.ntfyTopic.trim() : "";
	if (!ntfyTopic) {
		throw new Error("Set ntfyTopic to a unique ntfy topic name");
	}

	if (!Array.isArray(raw.watches) || raw.watches.length === 0) {
		throw new Error("Add at least one entry to watches");
	}

	return {
		steamApiKey,
		ntfyTopic,
		ntfyUrl:
			typeof raw.ntfyUrl === "string" && raw.ntfyUrl.trim()
				? raw.ntfyUrl.trim()
				: DEFAULT_NTFY_URL,
		ntfyToken: typeof raw.ntfyToken === "string" ? raw.ntfyToken : "",
		pollIntervalMinutes: parseOptionalNumber(
			raw.pollIntervalMinutes,
			"pollIntervalMinutes",
			DEFAULT_POLL_INTERVAL_MINUTES,
		),
		staleAfterMinutes: parseOptionalNumber(
			raw.staleAfterMinutes,
			"staleAfterMinutes",
			DEFAULT_STALE_AFTER_MINUTES,
		),
		watches: raw.watches.map(parseWatch),
	};
}

export function configFromEnv(env: EnvLike): Config {
	let watches: unknown = env.WATCHES;
	if (typeof watches === "string") {
		try {
			watches = JSON.parse(watches);
		} catch {
			throw new Error("WATCHES must be valid JSON");
		}
	}

	return parseConfig({
		steamApiKey: env.STEAM_API_KEY,
		ntfyTopic: env.NTFY_TOPIC,
		ntfyUrl: env.NTFY_URL,
		ntfyToken: env.NTFY_TOKEN,
		pollIntervalMinutes: env.POLL_INTERVAL_MINUTES,
		staleAfterMinutes: env.STALE_AFTER_MINUTES,
		watches,
	});
}

export function parseState(raw: unknown): State {
	if (!raw) {
		return { lastCheckedAt: null, players: {} };
	}
	if (isRecord(raw) && "players" in raw && isRecord(raw.players)) {
		const players: Record<string, string | null> = {};
		for (const [steamId, game] of Object.entries(raw.players)) {
			players[steamId] = typeof game === "string" ? game : null;
		}
		return {
			lastCheckedAt:
				typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : null,
			players,
		};
	}
	if (isRecord(raw)) {
		const players: Record<string, string | null> = {};
		for (const [steamId, game] of Object.entries(raw)) {
			players[steamId] = typeof game === "string" ? game : null;
		}
		return { lastCheckedAt: null, players };
	}
	return { lastCheckedAt: null, players: {} };
}
