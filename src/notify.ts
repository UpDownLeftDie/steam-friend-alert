import {
	type Alert,
	type Config,
	DEFAULT_NTFY_URL,
	type NotificationTarget,
	steamProfileUrl,
} from "./types.ts";

async function post(
	url: string,
	init: RequestInit,
	label: string,
): Promise<void> {
	const res = await fetch(url, { method: "POST", ...init });
	if (!res.ok) {
		throw new Error(`${label} send failed: ${res.status} ${res.statusText}`);
	}
}

async function sendNtfy(
	target: Extract<NotificationTarget, { type: "ntfy" }>,
	alert: Alert,
): Promise<void> {
	const url = new URL(`${target.url || DEFAULT_NTFY_URL}/${target.topic}`);
	const headers: Record<string, string> = {
		Title: alert.title,
		Priority: "default",
		Tags: "video_game",
	};
	if (target.token) {
		headers.Authorization = `Bearer ${target.token}`;
	}
	await post(url.toString(), { headers, body: alert.message }, "ntfy");
}

async function sendDiscord(
	target: Extract<NotificationTarget, { type: "discord" }>,
	alert: Alert,
): Promise<void> {
	await post(
		target.webhookUrl,
		{
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				username: "Steam Friend Alert",
				embeds: [
					{
						title: alert.title,
						description: alert.message,
						url: steamProfileUrl(alert.steamId),
						color: 0x66c0f4,
					},
				],
			}),
		},
		"discord",
	);
}

async function sendWebhook(
	target: Extract<NotificationTarget, { type: "webhook" }>,
	alert: Alert,
): Promise<void> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (target.authorization) {
		headers.Authorization = target.authorization;
	}
	await post(
		target.url,
		{
			headers,
			body: JSON.stringify({
				title: alert.title,
				message: alert.message,
				label: alert.label,
				game: alert.game,
				steamId: alert.steamId,
				profileUrl: steamProfileUrl(alert.steamId),
			}),
		},
		"webhook",
	);
}

async function sendPushover(
	target: Extract<NotificationTarget, { type: "pushover" }>,
	alert: Alert,
): Promise<void> {
	await post(
		"https://api.pushover.net/1/messages.json",
		{
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				token: target.apiToken,
				user: target.userKey,
				title: alert.title,
				message: alert.message,
				url: steamProfileUrl(alert.steamId),
				url_title: "Steam profile",
			}),
		},
		"pushover",
	);
}

async function sendGotify(
	target: Extract<NotificationTarget, { type: "gotify" }>,
	alert: Alert,
): Promise<void> {
	await post(
		`${target.url}/message`,
		{
			headers: {
				"content-type": "application/json",
				"X-Gotify-Key": target.token,
			},
			body: JSON.stringify({
				title: alert.title,
				message: alert.message,
				priority: target.priority,
			}),
		},
		"gotify",
	);
}

async function sendTo(target: NotificationTarget, alert: Alert): Promise<void> {
	switch (target.type) {
		case "ntfy":
			return sendNtfy(target, alert);
		case "discord":
			return sendDiscord(target, alert);
		case "webhook":
			return sendWebhook(target, alert);
		case "pushover":
			return sendPushover(target, alert);
		case "gotify":
			return sendGotify(target, alert);
	}
}

export async function sendAlert(config: Config, alert: Alert): Promise<void> {
	const results = await Promise.allSettled(
		config.notifications.map((target) => sendTo(target, alert)),
	);
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			const type = config.notifications[index]?.type ?? "notification";
			const reason = result.reason;
			console.error(
				`${type} send failed:`,
				reason instanceof Error ? reason.message : reason,
			);
		}
	}
}
