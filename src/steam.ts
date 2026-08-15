import type { SteamPlayer } from "./types.ts";

interface SteamSummariesResponse {
	response?: {
		players?: SteamPlayer[];
	};
}

export async function fetchPlayerSummaries(
	apiKey: string,
	steamIds: string[],
): Promise<SteamPlayer[]> {
	const url = new URL(
		"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
	);
	url.searchParams.set("key", apiKey);
	url.searchParams.set("steamids", steamIds.join(","));

	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(
			`Steam API request failed: ${res.status} ${res.statusText}`,
		);
	}
	const data = (await res.json()) as SteamSummariesResponse;
	return data.response?.players ?? [];
}
