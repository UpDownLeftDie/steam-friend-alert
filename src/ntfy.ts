import { DEFAULT_NTFY_URL } from "./types.ts";

export async function sendNtfyAlert(
	ntfyUrl: string,
	ntfyToken: string,
	topic: string,
	title: string,
	message: string,
): Promise<void> {
	const url = new URL(`${ntfyUrl || DEFAULT_NTFY_URL}/${topic}`);
	const headers: Record<string, string> = {
		Title: title,
		Priority: "default",
		Tags: "video_game",
	};
	if (ntfyToken) {
		headers.Authorization = `Bearer ${ntfyToken}`;
	}
	const res = await fetch(url, {
		method: "POST",
		headers,
		body: message,
	});
	if (!res.ok) {
		console.error(`ntfy send failed: ${res.status} ${res.statusText}`);
	}
}
