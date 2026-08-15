import { configFromEnv, parseState } from "./config.ts";
import { pollOnce } from "./poll.ts";

const STATE_KEY = "state";

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
				NTFY_TOPIC: env.NTFY_TOPIC,
				NTFY_URL: env.NTFY_URL,
				NTFY_TOKEN: env.NTFY_TOKEN,
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
				message.includes("Set ntfyTopic") ||
				message.includes("Add at least one") ||
				message.includes("WATCHES must be valid JSON")
			) {
				controller.noRetry();
			}
			throw err;
		}
	},
} satisfies ExportedHandler<Env>;
