import { sendAlert } from "./notify.ts";
import { fetchPlayerSummaries } from "./steam.ts";
import {
	type Config,
	DEFAULT_STALE_AFTER_MINUTES,
	type GameFilter,
	type State,
} from "./types.ts";

function pruneUnwatchedPlayers(state: State, watchedIds: Set<string>): void {
	for (const steamId of Object.keys(state.players)) {
		if (!watchedIds.has(steamId)) {
			delete state.players[steamId];
		}
	}
}

export function isStateStale(
	lastCheckedAt: string | null,
	staleAfterMinutes: number,
): boolean {
	if (!lastCheckedAt) return true;
	const last = Date.parse(lastCheckedAt);
	if (Number.isNaN(last)) return true;
	return Date.now() - last > staleAfterMinutes * 60 * 1000;
}

/**
 * Whether an alert should fire for this friend/game under the filter rules.
 * Effective list = global games ∪ per-friend games.
 * exclude + empty list → alert all; include + empty list → alert none.
 */
export function passesGameFilter(
	filter: GameFilter,
	steamId: string,
	gameName: string,
): boolean {
	const friend = filter.bySteamId[steamId];
	const mode = friend?.mode ?? filter.mode;
	const list = [...filter.games, ...(friend?.games ?? [])];
	if (list.length === 0) {
		return mode === "exclude";
	}
	const lower = gameName.toLowerCase();
	const matched = list.some((name) => lower.includes(name.toLowerCase()));
	return mode === "exclude" ? !matched : matched;
}

export async function pollOnce(
	config: Config,
	state: State,
	persist: (state: State) => Promise<void>,
): Promise<void> {
	const uniqueSteamIds = [...new Set(config.watches.map((w) => w.steamId))];
	const watchedIds = new Set(uniqueSteamIds);
	pruneUnwatchedPlayers(state, watchedIds);

	const staleAfterMinutes =
		config.staleAfterMinutes ?? DEFAULT_STALE_AFTER_MINUTES;
	const stale = isStateStale(state.lastCheckedAt, staleAfterMinutes);
	if (stale && state.lastCheckedAt) {
		console.log(
			`[state] Last check was ${state.lastCheckedAt} (stale after ${staleAfterMinutes}m) — treating as a new session.`,
		);
	}

	const players = await fetchPlayerSummaries(
		config.steamApiKey,
		uniqueSteamIds,
	);
	const playerById = new Map(players.map((p) => [p.steamid, p]));

	for (const steamId of uniqueSteamIds) {
		const player = playerById.get(steamId);
		const currentGame = player?.gameextrainfo ?? null;
		const previousGame = stale ? null : (state.players[steamId] ?? null);

		if (currentGame && currentGame !== previousGame) {
			if (passesGameFilter(config.gameFilter, steamId, currentGame)) {
				const watchesForFriend = config.watches.filter(
					(w) => w.steamId === steamId,
				);
				const label =
					watchesForFriend[0]?.label ?? player?.personaname ?? steamId;
				console.log(`[alert] ${label} started playing ${currentGame}`);
				await sendAlert(config, {
					title: `${label} is now playing`,
					message: currentGame,
					label,
					game: currentGame,
					steamId,
				});
			} else {
				console.log(
					`[filter] Skipping ${currentGame} for ${steamId} (game filter)`,
				);
			}
		}

		state.players[steamId] = currentGame;
	}

	state.lastCheckedAt = new Date().toISOString();
	await persist(state);
}
