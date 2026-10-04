import {
	fallbackFilterFromEnvironment,
	gameFilterAdmin,
	loadSettings,
	watchesFromEnvironment,
} from "./admin.ts";
import { configFromEnvironment, mergeSettings, parseState } from "./config.ts";
import { pollOnce } from "./poll.ts";
import type { Watch } from "./types.ts";

const STATE_KEY = "state";

interface WorkerEnvironment {
	STEAM_API_KEY: string;
	NOTIFICATIONS: string;
	STALE_AFTER_MINUTES?: string;
	WATCHES?: string;
	GAME_FILTER?: string;
	ADMIN_SECRET?: string;
	STATE: KVNamespace;
}

function baseConfigFromEnvironment(environment: WorkerEnvironment) {
	return configFromEnvironment({
		STEAM_API_KEY: environment.STEAM_API_KEY,
		NOTIFICATIONS: environment.NOTIFICATIONS,
		STALE_AFTER_MINUTES: environment.STALE_AFTER_MINUTES,
		WATCHES: environment.WATCHES,
		GAME_FILTER: environment.GAME_FILTER,
	});
}

function resolveWatches(environment: WorkerEnvironment): Watch[] {
	try {
		return baseConfigFromEnvironment(environment).watches;
	} catch {
		return watchesFromEnvironment(environment);
	}
}

function resolveFallbackFilter(environment: WorkerEnvironment) {
	try {
		return baseConfigFromEnvironment(environment).gameFilter;
	} catch {
		return fallbackFilterFromEnvironment(environment);
	}
}

/**
Env view for admin that prefers parsed config watches/filter when available.
*/
function adminEnvironment(environment: WorkerEnvironment): WorkerEnvironment {
	const watches = resolveWatches(environment);
	const filter = resolveFallbackFilter(environment);
	return {
		...environment,
		WATCHES: JSON.stringify(watches),
		GAME_FILTER: JSON.stringify(filter),
	};
}

export default {
	async fetch(request, environment): Promise<Response> {
		const adminResponse = await gameFilterAdmin.fetch(request, adminEnvironment(environment));
		if (adminResponse) return adminResponse;

		return new Response("steam-friend-alert\n", {
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	},

	async scheduled(controller, environment): Promise<void> {
		try {
			const settings = await loadSettings(environment.STATE);
			const baseConfig = configFromEnvironment({
				STEAM_API_KEY: environment.STEAM_API_KEY,
				NOTIFICATIONS: environment.NOTIFICATIONS,
				STALE_AFTER_MINUTES: environment.STALE_AFTER_MINUTES,
				WATCHES:
					settings?.watches === undefined
						? environment.WATCHES
						: JSON.stringify(settings.watches),
				GAME_FILTER: environment.GAME_FILTER,
			});
			const config = settings
				? mergeSettings(baseConfig, settings)
				: baseConfig;
			const stored = await environment.STATE.get(STATE_KEY, "json");
			const state = parseState(stored);
			await pollOnce(config, state, async (next) => {
				await environment.STATE.put(STATE_KEY, JSON.stringify(next));
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Poll failed:", message);
			if (
				message.includes("Set steamApiKey") ||
				message.includes("Set NOTIFICATIONS") ||
				message.includes("Add at least one") ||
				message.includes("WATCHES must be valid JSON") ||
				message.includes("NOTIFICATIONS must be") ||
				message.includes("GAME_FILTER must be")
			) {
				controller.noRetry();
			}
			throw error;
		}
	},
} satisfies ExportedHandler<WorkerEnvironment>;
