import { configFromEnv, parseState } from "./config.ts";
import { pollOnce } from "./poll.ts";

const STATE_KEY = "state";

interface WorkerEnv {
	STEAM_API_KEY: string;
	NOTIFICATIONS: string;
	STALE_AFTER_MINUTES?: string;
	WATCHES?: string;
	STATE: KVNamespace;
}

export default {
	async fetch(): Promise<Response> {
		return new Response("steam-friend-alert\n", {
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	},

	async scheduled(controller, env): Promise<void> {
		try {
			const config = configFromEnv({
				STEAM_API_KEY: env.STEAM_API_KEY,
				NOTIFICATIONS: env.NOTIFICATIONS,
				STALE_AFTER_MINUTES: env.STALE_AFTER_MINUTES,
				WATCHES: env.WATCHES,
			});
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
				message.includes("NOTIFICATIONS must be")
			) {
				controller.noRetry();
			}
			throw err;
		}
	},
} satisfies ExportedHandler<WorkerEnv>;
