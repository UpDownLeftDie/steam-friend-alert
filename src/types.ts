export interface Watch {
	steamId: string;
	label?: string;
	/** Optional case-insensitive substring matches against the game's display name. Omit (or use []) to alert on any game. */
	gameNames?: string[];
}

export interface Config {
	steamApiKey: string;
	ntfyTopic: string;
	ntfyUrl: string;
	ntfyToken: string;
	pollIntervalMinutes: number;
	/** If the last successful poll is older than this, forget prior games and treat as a new session. */
	staleAfterMinutes?: number;
	watches: Watch[];
}

export interface State {
	lastCheckedAt: string | null;
	players: Record<string, string | null>;
}

export interface SteamPlayer {
	steamid: string;
	personaname: string;
	gameextrainfo?: string;
}

/** Default: treat state as a new session if we haven't polled in 12 hours. */
export const DEFAULT_STALE_AFTER_MINUTES = 12 * 60;

export const DEFAULT_NTFY_URL = "https://ntfy.sh";
export const DEFAULT_POLL_INTERVAL_MINUTES = 5;

export type EnvLike = Record<string, string | undefined>;
