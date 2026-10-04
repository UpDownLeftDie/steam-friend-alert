# Steam Friend Activity Alerts

Polls the Steam Web API for chosen friends and sends a notification when one of them starts playing a game. Optional game filters let you ignore titles globally or per friend, or flip to an allowlist so you only alert on selected games.

Supported destinations: [ntfy](https://ntfy.sh), [Discord](https://discord.com/developers/docs/resources/webhook) webhooks, generic JSON webhooks, [Pushover](https://pushover.net), and [Gotify](https://gotify.net). Enable as many as you want; each alert is sent to all of them.

Do the [setup](#setup) steps once, then run [locally](#local) or [deploy to the cloud](#cloud-deploy).

## Setup

### Steam API key

Go to <https://steamcommunity.com/dev/apikey>, sign in, and register a key (any domain name works, e.g. `localhost`). Free, no approval wait.

### Friends to watch

For each friend: open their Steam profile and look up their **SteamID64** (17-digit number) using <https://steamid.io> — paste their profile URL in and copy the "steamID64" value.

Steam only reports a friend's **current** game. They have to actually be in a game when a poll runs — offline, or signed into Steam but not playing, will not trigger an alert.

Their profile's **Game details** privacy also has to be visible to the API: **Public**, or **Friends Only** if you are friends with them on the account tied to your API key. If Game details is **Private**, the API returns no game and you will never get an alert.

Build a `watches` array:

```json
[
  { "steamId": "76561197960287930", "label": "Charlie" }
]
```

- `label` is optional — falls back to their Steam display name if omitted.
- You can watch as many friends as you like; the script batches them into one API call per poll. IDs removed from `watches` are dropped from stored state automatically.
- To limit which games alert, use [`gameFilter`](#game-filters) (not per-watch lists). Legacy `gameNames` on a watch is still accepted and migrated into that friend’s include list.

### Game filters

`gameFilter` controls which games trigger alerts after a friend starts something new:

| Field | Meaning |
| --- | --- |
| `mode` | `exclude` (default) — skip listed games; `include` — only alert on listed games |
| `games` | Global list of case-insensitive substrings |
| `bySteamId` | Optional per-friend `{ mode?, games }` — games are **unioned** with the global list; `mode` overrides the global mode for that friend |

Empty list behavior: `exclude` → alert on every game; `include` → alert on none.

```json
{
  "mode": "exclude",
  "games": ["Wallpaper Engine", "Idle"],
  "bySteamId": {
    "76561197960287930": {
      "mode": "include",
      "games": ["Counter-Strike 2", "Dota 2"]
    }
  }
}
```

Locally, put this in `config.json`. On Workers, set optional env/var `GAME_FILTER` to the same JSON, or edit filters in the [`/admin`](#admin-ui-workers) UI. A saved filter overrides `GAME_FILTER` until you change it again.

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
  ],
  "gameFilter": {
    "mode": "exclude",
    "games": ["Wallpaper Engine"],
    "bySteamId": {}
  }
}
```

`staleAfterMinutes` (optional, default 720 / 12h): if the last successful poll is older than this, prior games are forgotten and anyone still playing will alert again (covers “process was off overnight”).

```bash
pnpm install
pnpm start
```

`pnpm start` stays running: it polls on the interval you set and prints a log line for each alert it sends. Closing the terminal stops it.
`pnpm start:once` runs once and then closes

To keep it running in the background or across reboots, use whatever process manager you prefer ([PM2](https://pm2.keymetrics.io), systemd, launchd, Task Scheduler, etc.).

State is stored in `state.json` next to the project (or `STATE_PATH`).

## Cloud deploy

Skip `config.json`. Put [notifications](#notifications) JSON in the `NOTIFICATIONS` secret, and the Steam API key and webhook URLs in secrets, not in committed files. Friends can live in the `WATCHES` variable or be saved from [`/admin`](#admin-ui-workers).

**Cloudflare Workers** is the best free option: a cron every 5 minutes, KV for last-seen games, no always-on VM. Waiting on Steam and notification APIs does not count toward the [10ms free-plan CPU limit](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

**Fly.io** runs the same Node process as local, with a volume for state. Use it if you already have Fly or want a long-running process.

### Cloudflare Workers

1. Install deps and copy local Worker secrets:

   ```bash
   pnpm install
   cp .dev.vars.example .dev.vars
   ```

2. Edit `wrangler.jsonc` `vars`: set `WATCHES` if you want friends declared in config. You can leave it unset and add friends in [`/admin`](#admin-ui-workers) instead. Change the cron if you want a different interval (`*/5 * * * *` is every 5 minutes, UTC).

3. Put `STEAM_API_KEY`, the real `NOTIFICATIONS` JSON, and `ADMIN_SECRET` (password for `/admin`) in `.dev.vars`, then:

   ```bash
   pnpm dev:worker
   curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
   ```

4. Deploy, then set secrets (this overwrites `NOTIFICATIONS` from `wrangler.jsonc` if you set it here):

   ```bash
   pnpm deploy:worker
   ```

   then run either

   ```bash
   pnpm wrangler secret bulk .dev.vars
   ```

   OR manually set each secret:

   ```bash
   pnpm wrangler secret put STEAM_API_KEY
   pnpm wrangler secret put NOTIFICATIONS
   pnpm wrangler secret put ADMIN_SECRET
   ```

   KV is created automatically on first deploy.

5. Confirm the Worker is live (HTTP returns `steam-friend-alert`) and check **Cron Events** in the Cloudflare dashboard after a few minutes.

State lives in KV. If `lastCheckedAt` is older than `STALE_AFTER_MINUTES` (default 720), the next poll treats it as a new session.

### Admin UI (Workers)

With `ADMIN_SECRET` set, open `https://YOUR_WORKER/admin` and sign in.

Two ways to choose friends:

- **Declarative:** set the `WATCHES` variable and leave “Use this list instead of the WATCHES variable” unchecked. Deploys keep owning that list.
- **UI:** paste friends in `/admin`, check that box, and save. The list is stored in KV key `settings` and replaces `WATCHES` on the next poll. Uncheck the box and save to go back to the variable. `WATCHES` can be omitted if this list is saved.

Game filters always save to that same KV key and override `GAME_FILTER`. Notification targets stay in the `NOTIFICATIONS` secret.

Auth: password form sets an HttpOnly cookie (SHA-256 of the secret), or send `Authorization: Bearer <ADMIN_SECRET>`. Without `ADMIN_SECRET`, `/admin` returns 503.

Admin auth/UI chrome comes from [`@codekitties/workers-mini-admin`](https://www.npmjs.com/package/@codekitties/workers-mini-admin).

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

- Alerts only fire when a watched friend is currently in a game **and** their profile's Game details privacy is Public (or Friends Only to the API-key account). Offline, not-playing, and hidden game details all look the same: no game, no alert.
- Steam's default API rate limit (100k calls/day) is far more than this needs even at a 1-minute poll interval with dozens of friends.
- There's no push mechanism from Steam itself — this only works by polling, so alerts land up to one poll interval late.
- `config.json`, `.dev.vars`, and `state.json` are gitignored — never commit API keys, webhook URLs, or tokens.
