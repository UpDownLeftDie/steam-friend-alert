# Steam Friend Activity Alerts

Polls the Steam Web API for chosen friends and sends a notification when one of them starts playing a game — either any game, or a specific one you name.

Supported destinations: [ntfy](https://ntfy.sh), [Discord](https://discord.com/developers/docs/resources/webhook) webhooks, generic JSON webhooks, [Pushover](https://pushover.net), and [Gotify](https://gotify.net). Enable as many as you want; each alert is sent to all of them.

Do the [setup](#setup) steps once, then run [locally](#local) or [deploy to the cloud](#cloud-deploy).

## Setup

### Steam API key

Go to <https://steamcommunity.com/dev/apikey>, sign in, and register a key (any domain name works, e.g. `localhost`). Free, no approval wait.

### Friends to watch

For each friend: open their Steam profile and look up their **SteamID64** (17-digit number) using <https://steamid.io> — paste their profile URL in and copy the "steamID64" value.

A friend's game activity is only visible through the API if their profile's "Game details" privacy setting is Public (or Friends Only, if you're actually friends with them on the account tied to your API key). If it's set to Private, you won't get anything back for them.

Build a `watches` array:

```json
[
  { "steamId": "76561197960287930", "label": "Charlie" },
  {
    "steamId": "76561197960287930",
    "label": "Charlie",
    "gameNames": ["Counter-Strike 2", "Dota 2"]
  }
]
```

- Omit `gameNames` (or use `[]`) to get alerted whenever that friend starts **any** game.
- Set `gameNames` to one or more titles if you only care about those games (substring match, case-insensitive — any match alerts).
- `label` is optional — falls back to their Steam display name if omitted.
- You can watch as many friends as you like; the script batches them into one API call per poll. IDs removed from `watches` are dropped from stored state automatically.

### Notifications

Build a `notifications` array with one object per destination.

#### ntfy

ntfy needs no account — a "topic" is just a private-ish channel name. Pick something unpredictable (e.g. `steam-alerts-8f2k1`), since anyone who knows the exact name can subscribe to it.

Then either:

- Install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) and subscribe to your topic, or
- Just open `https://ntfy.sh/your-topic-name` in a browser to watch it there.

If you self-host ntfy, set `url` to that origin and `token` if the topic is protected.

```json
{ "type": "ntfy", "topic": "steam-alerts-8f2k1", "url": "https://ntfy.sh", "token": "" }
```

#### Discord webhook

In a Discord channel: **Edit Channel → Integrations → Webhooks → New Webhook**. Copy the URL.

```json
{ "type": "discord", "webhookUrl": "https://discord.com/api/webhooks/ID/TOKEN" }
```

#### Generic webhook

POSTs JSON to any URL. Use this for [Apprise API](https://github.com/caronc/apprise-api), Home Assistant, or a custom endpoint. `authorization` is sent as the `Authorization` header (include `Bearer` if needed).

```json
{ "type": "webhook", "url": "https://example.com/hooks/steam", "authorization": "" }
```

Body:

```json
{
  "title": "Charlie is now playing",
  "message": "Counter-Strike 2",
  "label": "Charlie",
  "game": "Counter-Strike 2",
  "steamId": "76561197960287930",
  "profileUrl": "https://steamcommunity.com/profiles/76561197960287930"
}
```

#### Pushover

Create an application at <https://pushover.net/apps/build> to get an API token. Your user key is on the [Pushover dashboard](https://pushover.net).

```json
{ "type": "pushover", "userKey": "USER_KEY", "apiToken": "APP_TOKEN" }
```

#### Gotify

Create an application in your Gotify server and copy its token.

```json
{ "type": "gotify", "url": "https://gotify.example.com", "token": "APP_TOKEN", "priority": 5 }
```

## Local

Requires [Node.js](https://nodejs.org) 24+ and [pnpm](https://pnpm.io) (or npm).

Copy `config.example.json` to `config.json` and fill in your Steam API key plus the `watches` and `notifications` arrays from [setup](#setup):

```json
{
  "steamApiKey": "YOUR_STEAM_API_KEY",
  "notifications": [
    { "type": "ntfy", "topic": "steam-alerts-8f2k1" },
    { "type": "discord", "webhookUrl": "https://discord.com/api/webhooks/ID/TOKEN" }
  ],
  "pollIntervalMinutes": 5,
  "staleAfterMinutes": 720,
  "watches": [
    { "steamId": "76561197960287930", "label": "Charlie" }
  ]
}
```

`staleAfterMinutes` (optional, default 720 / 12h): if the last successful poll is older than this, prior games are forgotten and anyone still playing will alert again (covers “process was off overnight”).

```bash
pnpm install
pnpm start
```

Leave it running — it polls on the interval you set and prints a log line for each alert it sends.

```bash
pnpm start:once   # one poll, then exit
```

To keep it running across logouts and reboots:

```bash
pnpm add -g pm2
pm2 start "pnpm start" --name steam-alerts
pm2 save
pm2 startup   # follow the printed instructions to launch on boot
```

State is stored in `state.json` next to the project (or `STATE_PATH`).

## Cloud deploy

Skip `config.json`. Use the same [watches](#friends-to-watch) and [notifications](#notifications) JSON as environment variables `WATCHES` and `NOTIFICATIONS`. Put the Steam API key, tokens, and webhook URLs in secrets, not in committed files.

**Cloudflare Workers** is the best free option: a cron every 5 minutes, KV for last-seen games, no always-on VM. Waiting on Steam and notification APIs does not count toward the [10ms free-plan CPU limit](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

**Fly.io** runs the same Node process as local, with a volume for state. Use it if you already have Fly or want a long-running process.

### Cloudflare Workers

1. Install deps and copy local Worker secrets:

   ```bash
   pnpm install
   cp .dev.vars.example .dev.vars
   ```

2. Edit `wrangler.jsonc` `vars`: `WATCHES` and a placeholder `NOTIFICATIONS` if you want. Change the cron if you want a different interval (`*/5 * * * *` is every 5 minutes, UTC).

3. Put `STEAM_API_KEY` and the real `NOTIFICATIONS` JSON in `.dev.vars`, then:

   ```bash
   pnpm dev:worker
   curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
   ```

4. Deploy, then set secrets (this overwrites `NOTIFICATIONS` from `wrangler.jsonc` if you set it here):

   ```bash
   pnpm deploy
   pnpm wrangler secret put STEAM_API_KEY
   pnpm wrangler secret put NOTIFICATIONS
   ```

   KV is created automatically on first deploy.

5. Confirm the Worker is live (HTTP returns `steam-friend-alert`) and check **Cron Events** in the Cloudflare dashboard after a few minutes.

State lives in KV. If `lastCheckedAt` is older than `STALE_AFTER_MINUTES` (default 720), the next poll treats it as a new session.

### Fly.io

1. Install the [Fly CLI](https://fly.io/docs/flyctl/install/) and log in.

2. Edit `fly.toml`: change `app` to a unique name, and set `WATCHES`. Put `NOTIFICATIONS` in a Fly secret if it includes tokens or webhook URLs.

3. Launch (skip generating a new config if it asks):

   ```bash
   fly launch --copy-config --name YOUR-APP-NAME
   fly volumes create steam_alert_state --size 1
   fly secrets set STEAM_API_KEY=your-key
   fly deploy
   ```

The process listens on `:8080` for Fly health checks and polls in the background. State is stored on the volume so restarts do not re-alert people already in-game.

You can also point Fly at a `config.json` with `CONFIG_PATH` / `STATE_PATH` instead of env vars.

## Notes

- Steam's default API rate limit (100k calls/day) is far more than this needs even at a 1-minute poll interval with dozens of friends.
- There's no push mechanism from Steam itself — this only works by polling, so alerts land up to one poll interval late.
- `config.json`, `.dev.vars`, and `state.json` are gitignored — never commit API keys, webhook URLs, or tokens.
