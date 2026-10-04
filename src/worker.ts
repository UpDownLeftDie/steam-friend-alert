import {
	fallbackFilterFromEnv,
	gameFilterAdmin,
	loadSettings,
	watchesFromEnv,
} from "./admin.ts";
import { configFromEnv, mergeSettings, parseState } from "./config.ts";
import { pollOnce } from "./poll.ts";
import type { Watch } from "./types.ts";

const STATE_KEY = "state";

interface WorkerEnv {
	STEAM_API_KEY: string;
	NOTIFICATIONS: string;
	STALE_AFTER_MINUTES?: string;
	WATCHES?: string;
	GAME_FILTER?: string;
	ADMIN_SECRET?: string;
	STATE: KVNamespace;
}

function baseConfigFromEnv(env: WorkerEnv) {
	return configFromEnv({
		STEAM_API_KEY: env.STEAM_API_KEY,
		NOTIFICATIONS: env.NOTIFICATIONS,
		STALE_AFTER_MINUTES: env.STALE_AFTER_MINUTES,
		WATCHES: env.WATCHES,
		GAME_FILTER: env.GAME_FILTER,
	});
}

function resolveWatches(env: WorkerEnv): Watch[] {
	try {
		return baseConfigFromEnv(env).watches;
	} catch {
		return watchesFromEnv(env);
	}
}

function resolveFallbackFilter(env: WorkerEnv) {
	try {
		return baseConfigFromEnv(env).gameFilter;
	} catch {
		return fallbackFilterFromEnv(env);
	}
}

/** Env view for admin that prefers parsed config watches/filter when available. */
function adminEnv(env: WorkerEnv): WorkerEnv {
	const watches = resolveWatches(env);
	const filter = resolveFallbackFilter(env);
	return {
		...env,
		WATCHES: JSON.stringify(watches),
		GAME_FILTER: JSON.stringify(filter),
	};
}

export default {
	async fetch(request, env): Promise<Response> {
		const adminResponse = await gameFilterAdmin.fetch(request, adminEnv(env));
		if (adminResponse) return adminResponse;

		return new Response("steam-friend-alert\n", {
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	},

	async scheduled(controller, env): Promise<void> {
		try {
			const baseConfig = baseConfigFromEnv(env);
			const settings = await loadSettings(env.STATE);
			const config = settings
				? mergeSettings(baseConfig, settings)
				: baseConfig;
			const stored = await env.STATE.get(STATE_KEY, "json");
			const state = parseState(stored);
			await pollOnce(config, state, async (next) => {
				await env.STATE.put(STATE_KEY, JSON.stringify(next));
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
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
			throw err;
		}
	},
} satisfies ExportedHandler<WorkerEnv>;
