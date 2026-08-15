# Steam Friend Activity Alerts

Polls the Steam Web API for chosen friends and sends a push notification (via [ntfy](https://ntfy.sh)) when one of them starts playing a game — either any game, or a specific one you name.

Run it locally, or deploy for free on **Cloudflare Workers** (recommended) or **Fly.io**.

## 1. Get a Steam Web API key

Go to <https://steamcommunity.com/dev/apikey>, sign in, and register a key (any domain name works, e.g. `localhost`). Free, no approval wait.

## 2. Find SteamID64s for the friends you want to watch

For each friend: open their Steam profile and look up their **SteamID64** (17-digit number) using <https://steamid.io> — paste their profile URL in and copy the "steamID64" value.

**Important:** a friend's game activity is only visible through the API if their profile's "Game details" privacy setting is Public (or Friends Only, if you're actually friends with them on the account tied to your API key). If it's set to Private, you won't get anything back for them.

## 3. Pick an ntfy topic

ntfy needs no account — a "topic" is just a private-ish channel name. Pick something unpredictable (e.g. `jared-steam-alerts-8f2k1`), since anyone who knows the exact name can subscribe to it.

Then either:

- Install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) and subscribe to your topic, or
- Just open `https://ntfy.sh/your-topic-name` in a browser to watch it there.

If you self-host ntfy, set `ntfyUrl` / `NTFY_URL` to that origin and `ntfyToken` / `NTFY_TOKEN` if the topic is protected.

## 4. Configure

Copy `config.example.json` to `config.json` and fill it in:

```json
{
  "steamApiKey": "YOUR_STEAM_API_KEY",
  "ntfyTopic": "jared-steam-alerts-8f2k1",
  "ntfyUrl": "https://ntfy.sh",
  "ntfyToken": "",
  "pollIntervalMinutes": 5,
  "staleAfterMinutes": 720,
  "watches": [
    { "steamId": "76561197960287930", "label": "Robin" },
    {
      "steamId": "76561197960287930",
      "label": "Robin",
      "gameNames": ["Counter-Strike 2", "Dota 2"]
    }
  ]
}
```

- Omit `gameNames` (or use `[]`) to get alerted whenever that friend starts **any** game.
- Set `gameNames` to one or more titles if you only care about those games (substring match, case-insensitive — any match alerts).
- `label` is optional — falls back to their Steam display name if omitted.
- `staleAfterMinutes` (optional, default 720 / 12h): if the last successful poll is older than this, prior games are forgotten and anyone still playing will alert again (covers “process was off overnight”).
- You can watch as many friends as you like; the script batches them into one API call per poll. IDs removed from `watches` are dropped from stored state automatically.

Cloud deploys use environment variables instead of `config.json` — see below.

## 5. Run locally

Requires [Node.js](https://nodejs.org) 18+ and [pnpm](https://pnpm.io) (or npm).

```bash
pnpm install
pnpm start
```

Leave it running — it polls on the interval you set and prints a log line for each alert it sends.

```bash
pnpm start:once   # one poll, then exit
```

### Keeping it running on a machine

```bash
pnpm add -g pm2
pm2 start "pnpm start" --name steam-alerts
pm2 save
pm2 startup   # follow the printed instructions to launch on boot
```

## Deploy

**Cloudflare Workers** is the best free option for this: a cron trigger every 5 minutes, KV for last-seen games, no always-on VM. Waiting on Steam/ntfy does not count toward the [10ms free-plan CPU limit](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

**Fly.io** runs the same Node process as local, with a tiny volume for state. Use it if you already have Fly or want a long-running process.

### Cloudflare Workers (recommended)

1. Install deps and copy local Worker secrets:

   ```bash
   pnpm install
   cp .dev.vars.example .dev.vars
   ```

2. Edit `wrangler.jsonc` `vars` (`NTFY_TOPIC`, `WATCHES`, optional `NTFY_URL` / `STALE_AFTER_MINUTES`). Change the cron if you want a different interval (`*/5 * * * *` is every 5 minutes, UTC).

3. Put secrets in `.dev.vars` for local testing, then:

   ```bash
   pnpm dev:worker
   curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
   ```

4. Deploy:

   ```bash
   pnpm deploy
   pnpm wrangler secret put STEAM_API_KEY
   pnpm wrangler secret put NTFY_TOKEN
   ```

   KV is created automatically on first deploy. `NTFY_TOKEN` can be empty if the topic is public.

5. Confirm the Worker is live (HTTP returns `steam-friend-alert`) and check **Cron Events** in the Cloudflare dashboard after a few minutes.

### Fly.io

1. Install the [Fly CLI](https://fly.io/docs/flyctl/install/) and log in.

2. Edit `fly.toml`: change `app` to a unique name, set `NTFY_TOPIC` and `WATCHES`.

3. Launch (skip generating a new config if it asks):

   ```bash
   fly launch --copy-config --name YOUR-APP-NAME
   fly volumes create steam_alert_state --size 1
   fly secrets set STEAM_API_KEY=your-key NTFY_TOKEN=your-token
   fly deploy
   ```

   The process listens on `:8080` for Fly health checks and polls in the background. State is stored on the volume so restarts do not re-alert people already in-game.

You can also point Fly at a `config.json` with `CONFIG_PATH` / `STATE_PATH` instead of env vars.

## Notes

- Steam's default API rate limit (100k calls/day) is far more than this needs even at a 1-minute poll interval with dozens of friends.
- There's no push mechanism from Steam itself — this only works by polling, so alerts land up to one poll interval late.
- Local state is `state.json` next to the project (or `STATE_PATH`). On Workers it lives in KV. If `lastCheckedAt` is older than `staleAfterMinutes`, the next poll treats it as a new session.
- `config.json`, `.dev.vars`, and `state.json` are gitignored — never commit API keys or ntfy tokens.
