import {
	type Config,
	DEFAULT_GAME_FILTER,
	DEFAULT_GOTIFY_PRIORITY,
	DEFAULT_NTFY_URL,
	DEFAULT_POLL_INTERVAL_MINUTES,
	DEFAULT_STALE_AFTER_MINUTES,
	type EnvLike,
	type FriendGameFilter,
	type GameFilter,
	type GameFilterMode,
	type NotificationTarget,
	type Settings,
	type State,
	type Watch,
} from "./types.ts";

function isRecord(value: unknown): boolean {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? (value as Record<string, unknown>) : null;
}

function optionalString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function requireHttpUrl(value: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${field} must be a valid URL`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`${field} must be an http(s) URL`);
	}
	let end = value.length;
	while (end > 0 && value[end - 1] === "/") {
		end--;
	}
	return value.slice(0, end);
}

function parseGameFilterMode(
	value: unknown,
	field: string,
): GameFilterMode | undefined {
	if (value === undefined || value === "") return undefined;
	if (value === "exclude" || value === "include") return value;
	throw new Error(`${field} must be "exclude" or "include"`);
}

function parseStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${field} must be a string array`);
	}
	return value.map((item) => item.trim()).filter(Boolean);
}

function parseFriendGameFilter(
	value: unknown,
	field: string,
): FriendGameFilter {
	const record = asRecord(value);
	if (!record) {
		throw new Error(`${field} must be an object`);
	}
	const mode = parseGameFilterMode(record.mode, `${field}.mode`);
	const games =
		record.games === undefined
			? []
			: parseStringArray(record.games, `${field}.games`);
	const friend: FriendGameFilter = { games };
	if (mode !== undefined) friend.mode = mode;
	return friend;
}

export function parseGameFilter(raw: unknown): GameFilter {
	if (raw === undefined || raw === null) {
		return structuredClone(DEFAULT_GAME_FILTER);
	}
	const record = asRecord(raw);
	if (!record) {
		throw new Error("gameFilter must be an object");
	}
	const mode =
		parseGameFilterMode(record.mode, "gameFilter.mode") ??
		DEFAULT_GAME_FILTER.mode;
	const games =
		record.games === undefined
			? []
			: parseStringArray(record.games, "gameFilter.games");
	const bySteamId: Record<string, FriendGameFilter> = {};
	if (record.bySteamId !== undefined) {
		const map = asRecord(record.bySteamId);
		if (!map) {
			throw new Error("gameFilter.bySteamId must be an object");
		}
		for (const [steamId, friendRaw] of Object.entries(map)) {
			if (!steamId.trim()) {
				throw new Error("gameFilter.bySteamId keys must be non-empty steamIds");
			}
			bySteamId[steamId] = parseFriendGameFilter(
				friendRaw,
				`gameFilter.bySteamId.${steamId}`,
			);
		}
	}
	return { mode, games, bySteamId };
}

function ensureFriendFilter(
	filter: GameFilter,
	steamId: string,
): FriendGameFilter {
	const existing = filter.bySteamId[steamId];
	if (existing) return existing;
	const created: FriendGameFilter = { games: [] };
	filter.bySteamId[steamId] = created;
	return created;
}

function unionGames(into: string[], extras: string[]): void {
	const seen = new Set(into.map((g) => g.toLowerCase()));
	for (const game of extras) {
		const key = game.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		into.push(game);
	}
}

interface ParsedWatch {
	watch: Watch;
	legacyGameNames?: string[];
}

function parseWatch(value: unknown, index: number): ParsedWatch {
	const record = asRecord(value);
	if (!record || typeof record.steamId !== "string" || !record.steamId) {
		throw new Error(`watches[${index}] must include a steamId string`);
	}
	const watch: Watch = { steamId: record.steamId };
	if (record.label !== undefined) {
		if (typeof record.label !== "string") {
			throw new TypeError(`watches[${index}].label must be a string`);
		}
		watch.label = record.label;
	}
	let legacyGameNames: string[] | undefined;
	if (record.gameNames !== undefined) {
		legacyGameNames = parseStringArray(
			record.gameNames,
			`watches[${index}].gameNames`,
		);
	}
	return { watch, legacyGameNames };
}

function applyLegacyGameNames(
	gameFilter: GameFilter,
	steamId: string,
	gameNames: string[],
): void {
	if (gameNames.length === 0) return;
	const friend = ensureFriendFilter(gameFilter, steamId);
	friend.mode = "include";
	unionGames(friend.games, gameNames);
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

function parseGotifyPriority(value: unknown): number {
	if (value === undefined || value === "") return DEFAULT_GOTIFY_PRIORITY;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
		throw new Error("gotify priority must be an integer from 0 to 10");
	}
	return parsed;
}

function requireString(value: unknown, field: string): string {
	const parsed = optionalString(value);
	if (!parsed) throw new Error(`${field} is required`);
	return parsed;
}

function parseNotification(value: unknown, index: number): NotificationTarget {
	const record = asRecord(value);
	if (!record || typeof record.type !== "string") {
		throw new Error(`notifications[${index}] must include a type`);
	}
	const prefix = `notifications[${index}]`;
	switch (record.type) {
		case "ntfy":
			return {
				type: "ntfy",
				topic: requireString(record.topic, `${prefix}.topic`),
				url: optionalString(record.url) || DEFAULT_NTFY_URL,
				token: optionalString(record.token),
			};
		case "discord": {
			const webhookUrl = requireString(
				record.webhookUrl,
				`${prefix}.webhookUrl`,
			);
			return {
				type: "discord",
				webhookUrl: requireHttpUrl(webhookUrl, `${prefix}.webhookUrl`),
			};
		}
		case "webhook": {
			const url = requireString(record.url, `${prefix}.url`);
			return {
				type: "webhook",
				url: requireHttpUrl(url, `${prefix}.url`),
				authorization: optionalString(record.authorization),
			};
		}
		case "pushover":
			return {
				type: "pushover",
				userKey: requireString(record.userKey, `${prefix}.userKey`),
				apiToken: requireString(record.apiToken, `${prefix}.apiToken`),
			};
		case "gotify": {
			const url = requireString(record.url, `${prefix}.url`);
			return {
				type: "gotify",
				url: requireHttpUrl(url, `${prefix}.url`),
				token: requireString(record.token, `${prefix}.token`),
				priority: parseGotifyPriority(record.priority),
			};
		}
		default:
			throw new Error(`${prefix}: unknown type "${record.type}"`);
	}
}

export function parseConfig(raw: unknown): Config {
	const record = asRecord(raw);
	if (!record) {
		throw new Error("Config must be a JSON object");
	}

	const steamApiKey =
		typeof record.steamApiKey === "string" ? record.steamApiKey.trim() : "";
	if (!steamApiKey || steamApiKey === "YOUR_STEAM_API_KEY") {
		throw new Error(
			"Set steamApiKey (get one at https://steamcommunity.com/dev/apikey)",
		);
	}

	if (!Array.isArray(record.watches) || record.watches.length === 0) {
		throw new Error("Add at least one entry to watches");
	}

	if (
		!Array.isArray(record.notifications) ||
		record.notifications.length === 0
	) {
		throw new Error(
			"Add at least one notification (ntfy, discord, webhook, pushover, or gotify)",
		);
	}
	const notifications: NotificationTarget[] = record.notifications.map(
		(value, index) => parseNotification(value, index),
	);

	const gameFilter = parseGameFilter(record.gameFilter);
	const watches: Watch[] = [];
	for (const [index, value] of record.watches.entries()) {
		const { watch, legacyGameNames } = parseWatch(value, index);
		watches.push(watch);
		if (legacyGameNames?.length) {
			applyLegacyGameNames(gameFilter, watch.steamId, legacyGameNames);
		}
	}

	return {
		steamApiKey,
		notifications,
		pollIntervalMinutes: parseOptionalNumber(
			record.pollIntervalMinutes,
			"pollIntervalMinutes",
			DEFAULT_POLL_INTERVAL_MINUTES,
		),
		staleAfterMinutes: parseOptionalNumber(
			record.staleAfterMinutes,
			"staleAfterMinutes",
			DEFAULT_STALE_AFTER_MINUTES,
		),
		watches,
		gameFilter,
	};
}

function parseNotificationsJson(raw: string): unknown[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new TypeError("NOTIFICATIONS must be a JSON array");
		}
		return parsed;
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("NOTIFICATIONS")) {
			throw err;
		}
		throw new Error("NOTIFICATIONS must be valid JSON");
	}
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

	let gameFilter: unknown = env.GAME_FILTER;
	if (typeof gameFilter === "string" && gameFilter.trim()) {
		try {
			gameFilter = JSON.parse(gameFilter);
		} catch {
			throw new Error("GAME_FILTER must be valid JSON");
		}
	} else if (typeof gameFilter === "string") {
		gameFilter = undefined;
	}

	if (!env.NOTIFICATIONS) {
		throw new Error(
			"Set NOTIFICATIONS to a JSON array of notification targets",
		);
	}

	return parseConfig({
		steamApiKey: env.STEAM_API_KEY,
		notifications: parseNotificationsJson(env.NOTIFICATIONS),
		pollIntervalMinutes: env.POLL_INTERVAL_MINUTES,
		staleAfterMinutes: env.STALE_AFTER_MINUTES,
		watches,
		gameFilter,
	});
}

export function parseSettings(raw: unknown): Settings {
	if (!raw) {
		return { gameFilter: structuredClone(DEFAULT_GAME_FILTER) };
	}
	const record = asRecord(raw);
	if (!record) {
		throw new Error("Settings must be a JSON object");
	}
	const settings: Settings = {
		gameFilter: parseGameFilter(record.gameFilter),
	};
	if (record.watches !== undefined) {
		settings.watches = parseWatches(record.watches);
	}
	return settings;
}

/** Overlay KV/admin settings onto a base config. Omitted fields keep the base value. */
export function mergeSettings(config: Config, settings: Settings): Config {
	return {
		...config,
		gameFilter: structuredClone(settings.gameFilter),
		...(settings.watches !== undefined
			? { watches: structuredClone(settings.watches) }
			: {}),
	};
}

export function parseWatches(raw: unknown): Watch[] {
	if (!Array.isArray(raw)) {
		throw new Error("watches must be an array");
	}
	return raw.map((value, index) => parseWatch(value, index).watch);
}

/** One friend per line (`SteamID64` plus an optional label), or a JSON array. */
export function parseWatchesText(text: string): Watch[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("[")) {
		try {
			return parseWatches(JSON.parse(trimmed));
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("watches")) {
				throw err;
			}
			throw new Error("Watch list JSON is invalid");
		}
	}
	const watches: Watch[] = [];
	let index = 0;
	for (const line of text.split(/\r?\n/)) {
		const raw = line.trim();
		if (!raw || raw.startsWith("#")) continue;
		const splitAt = raw.search(/\s/);
		const steamId = splitAt === -1 ? raw : raw.slice(0, splitAt);
		const label = splitAt === -1 ? "" : raw.slice(splitAt).trim();
		const value: { steamId: string; label?: string } = { steamId };
		if (label) value.label = label;
		watches.push(parseWatch(value, index).watch);
		index++;
	}
	return watches;
}

export function formatWatches(watches: Watch[]): string {
	return watches
		.map((watch) =>
			watch.label?.trim()
				? `${watch.steamId} ${watch.label.trim()}`
				: watch.steamId,
		)
		.join("\n");
}

function toPlayerMap(
	raw: Record<string, unknown>,
): Record<string, string | null> {
	const players: Record<string, string | null> = {};
	for (const [steamId, game] of Object.entries(raw)) {
		players[steamId] = typeof game === "string" ? game : null;
	}
	return players;
}

export function parseState(raw: unknown): State {
	if (!raw) {
		return { lastCheckedAt: null, players: {} };
	}
	const record = asRecord(raw);
	if (record && "players" in record && isRecord(record.players)) {
		return {
			lastCheckedAt:
				typeof record.lastCheckedAt === "string" ? record.lastCheckedAt : null,
			players: toPlayerMap(record.players as Record<string, unknown>),
		};
	}
	if (record) {
		return { lastCheckedAt: null, players: toPlayerMap(record) };
	}
	return { lastCheckedAt: null, players: {} };
}

/** Parse textarea / newline-separated game titles into a trimmed list. */
export function gamesFromLines(text: string): string[] {
	const seen = new Set<string>();
	const games: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		games.push(trimmed);
	}
	return games;
}

export function gamesToLines(games: string[]): string {
	return games.join("\n");
}
