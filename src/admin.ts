import {
	createAdmin,
	type Field,
	formText,
} from "@codekitties/workers-mini-admin";
import {
	gamesFromLines,
	gamesToLines,
	parseGameFilter,
	parseSettings,
} from "./config.ts";
import {
	DEFAULT_GAME_FILTER,
	type FriendGameFilter,
	type GameFilter,
	type GameFilterMode,
	type Settings,
	type Watch,
} from "./types.ts";

export const SETTINGS_KEY = "settings";

export interface AdminEnv {
	ADMIN_SECRET?: string;
	STATE: KVNamespace;
	WATCHES?: string;
	GAME_FILTER?: string;
	STEAM_API_KEY?: string;
	NOTIFICATIONS?: string;
	STALE_AFTER_MINUTES?: string;
}

function uniqueWatches(watches: Watch[]): Watch[] {
	const seen = new Set<string>();
	const out: Watch[] = [];
	for (const watch of watches) {
		if (seen.has(watch.steamId)) continue;
		seen.add(watch.steamId);
		out.push(watch);
	}
	return out;
}

function parseModeField(
	value: string,
	field: string,
): GameFilterMode | undefined {
	if (value === "" || value === "default") return undefined;
	if (value === "exclude" || value === "include") return value;
	throw new Error(`${field} must be default, exclude, or include`);
}

export function gameFilterFromForm(
	form: FormData,
	watches: Watch[],
): GameFilter {
	const mode = parseModeField(formText(form, "mode"), "mode");
	if (mode === undefined) {
		throw new Error('Global mode must be "exclude" or "include"');
	}
	const games = gamesFromLines(formText(form, "games"));
	const bySteamId: Record<string, FriendGameFilter> = {};

	for (const watch of uniqueWatches(watches)) {
		const id = watch.steamId;
		const friendMode = parseModeField(
			formText(form, `friend_mode_${id}`),
			`friend mode for ${id}`,
		);
		const friendGames = gamesFromLines(formText(form, `friend_games_${id}`));
		if (friendMode === undefined && friendGames.length === 0) {
			continue;
		}
		const friend: FriendGameFilter = { games: friendGames };
		if (friendMode !== undefined) friend.mode = friendMode;
		bySteamId[id] = friend;
	}

	return parseGameFilter({ mode, games, bySteamId });
}

function modeSelectOptions(includeDefault: boolean): {
	value: string;
	label: string;
}[] {
	const options: { value: string; label: string }[] = [];
	if (includeDefault) {
		options.push({ value: "default", label: "Use global default" });
	}
	options.push(
		{ value: "exclude", label: "Exclude (ignore listed games)" },
		{ value: "include", label: "Include (only listed games)" },
	);
	return options;
}

function filterFields(filter: GameFilter, watches: Watch[]): Field[] {
	const fields: Field[] = [
		{
			type: "select",
			name: "mode",
			label: "Global mode",
			required: true,
			value: filter.mode,
			options: modeSelectOptions(false),
		},
		{
			type: "html",
			html: '<p class="hint"><strong>Exclude</strong> skips alerts for listed games. <strong>Include</strong> only alerts for listed games. Empty list: exclude → alert all; include → alert none.</p>',
		},
		{
			type: "textarea",
			name: "games",
			label: "Global games",
			hint: "One substring per line, case-insensitive",
			placeholder: "Idle\nWallpaper Engine",
			value: gamesToLines(filter.games),
		},
		{
			type: "html",
			html: '<h2 style="font-size:1.1rem;margin:1.5rem 0 0.5rem">Per friend</h2><p class="hint">Optional overrides. Friend games are unioned with the global list; mode override replaces the global mode for that friend only.</p>',
		},
	];

	const friends = uniqueWatches(watches);
	if (friends.length === 0) {
		fields.push({
			type: "html",
			html: '<p class="hint">No watches configured.</p>',
		});
		return fields;
	}

	for (const watch of friends) {
		const id = watch.steamId;
		const label = watch.label?.trim() || id;
		const friend = filter.bySteamId[id];
		fields.push({
			type: "fieldset",
			legend: label,
			hint: `SteamID ${id}`,
			fields: [
				{
					type: "select",
					name: `friend_mode_${id}`,
					label: "Mode override",
					value: friend?.mode ?? "default",
					options: modeSelectOptions(true),
				},
				{
					type: "textarea",
					name: `friend_games_${id}`,
					label: "Games",
					hint: "One substring per line; combined with global list",
					placeholder: "Counter-Strike",
					value: gamesToLines(friend?.games ?? []),
				},
			],
		});
	}

	return fields;
}

/** Returns null when no admin settings have been saved yet (use env/config filter). */
export async function loadSettings(kv: KVNamespace): Promise<Settings | null> {
	const stored = await kv.get(SETTINGS_KEY, "json");
	if (stored === null || stored === undefined) {
		return null;
	}
	try {
		return parseSettings(stored);
	} catch (err) {
		console.error("Invalid settings in KV, ignoring:", err);
		return null;
	}
}

export async function saveSettings(
	kv: KVNamespace,
	settings: Settings,
): Promise<void> {
	await kv.put(SETTINGS_KEY, JSON.stringify(settings));
}

export function watchesFromEnv(env: AdminEnv): Watch[] {
	if (!env.WATCHES) return [];
	try {
		const parsed: unknown = JSON.parse(env.WATCHES);
		if (!Array.isArray(parsed)) return [];
		const watches: Watch[] = [];
		for (const item of parsed) {
			if (
				typeof item === "object" &&
				item !== null &&
				typeof (item as { steamId?: unknown }).steamId === "string"
			) {
				const steamId = (item as { steamId: string; label?: unknown }).steamId;
				const label =
					typeof (item as { label?: unknown }).label === "string"
						? (item as { label: string }).label
						: undefined;
				watches.push(label !== undefined ? { steamId, label } : { steamId });
			}
		}
		return watches;
	} catch {
		return [];
	}
}

export function fallbackFilterFromEnv(env: AdminEnv): GameFilter {
	if (!env.GAME_FILTER?.trim()) {
		return structuredClone(DEFAULT_GAME_FILTER);
	}
	try {
		return parseGameFilter(JSON.parse(env.GAME_FILTER));
	} catch {
		return structuredClone(DEFAULT_GAME_FILTER);
	}
}

export const gameFilterAdmin = createAdmin<AdminEnv>({
	basePath: "/admin",
	title: "Game filters",
	getSecret: (env) => env.ADMIN_SECRET,
	async render({ env }) {
		const watches = watchesFromEnv(env);
		const settings = await loadSettings(env.STATE);
		const filter = settings?.gameFilter ?? fallbackFilterFromEnv(env);
		return {
			hint: "Stored in Workers KV and applied on the next poll. Watches and notifications stay in env / wrangler vars.",
			submitLabel: "Save filters",
			fields: filterFields(filter, watches),
		};
	},
	async save({ form, env }) {
		const watches = watchesFromEnv(env);
		const gameFilter = gameFilterFromForm(form, watches);
		await saveSettings(env.STATE, { gameFilter });
		return { flash: "Saved. Filters apply on the next poll." };
	},
});
