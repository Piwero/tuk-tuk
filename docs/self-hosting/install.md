# Install

⏱ 10 min (about 5 of them waiting for the first build) · Needs: Docker, about 2 GB of disk space

**Do this first:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
(Mac or Windows) or [Docker Engine](https://docs.docker.com/engine/install/) (Linux), and start it.

## 1. Install and start (5–8 min)

From a terminal:

1. Download Tuk Tuk:
   ```sh
   git clone https://github.com/Piwero/tuk-tuk.git && cd tuk-tuk
   ```
2. Create the master key and the database password (one time only):
   ```sh
   echo "APP_MASTER_KEY=$(openssl rand -base64 32)" > .env
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
   ```
3. Build and start it:
   ```sh
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. Open **http://localhost:8080** and choose your password.

The app builds on your own machine, so it runs on Intel/AMD and Apple Silicon (M1 to M4) alike.

> **Back up `.env`.** The master key in it encrypts your saved Google and AI
> credentials. If you lose it, you'll have to enter those again. Your tasks are
> not affected. See [Security](security.md#the-master-key). Don't change
> `POSTGRES_PASSWORD` later: the database keeps the one it was created with.

## Everyday commands

Run these from the `tuk-tuk` folder.

| To… | Run |
| --- | --- |
| Stop | `docker compose -f docker-compose.prod.yml down` |
| Start | `docker compose -f docker-compose.prod.yml up -d` |
| See logs | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Check it's running | `docker compose -f docker-compose.prod.yml ps` |

The app restarts by itself after a reboot as long as Docker is running. Your data
lives in a PostgreSQL database, in a Docker volume called `tuk-tuk-prod_pgdata`,
and survives `down`.

> **Never add `-v` to `down`.** `down -v` deletes the volume, and with it every
> task, habit and goal. Back up first: see [Upgrade and back up](upgrade.md#back-up).

## Change the port

Port 8080 already in use? Add these lines to `.env` (here using 8181), then run
the start command again:

```sh
TUK_TUK_PORT=8181
CORS_ORIGINS=["http://localhost:8181"]
```

`CORS_ORIGINS` lists every address you open the app at. Keep it in step with
the port, or Google Calendar sign-in won't return to the app.

## Use it from other devices

By default only the computer running Tuk Tuk can reach it at `localhost`. To
use it from your phone or laptop:

1. **Same Wi-Fi:** open `http://<computer-name-or-IP>:8080` on the other device.
2. **Anywhere:** install [Tailscale](https://tailscale.com) on both devices and
   use the computer's Tailscale name, for example `http://mybox:8080`. This
   keeps the app off the public internet.
3. Add each address to `CORS_ORIGINS` in `.env`, for example
   `CORS_ORIGINS=["http://localhost:8080", "http://mybox:8080"]`, then start again.

> **Use HTTPS for anything beyond your home network.** Over plain `http://`,
> your password and session travel unencrypted. Put the app behind HTTPS (see
> [Serve it over HTTPS](#serve-it-over-https)). Never expose it to the internet over plain http.

## Serve it over HTTPS

⏱ 10 min. Needed for Reminder notifications on any device other than the
computer running Tuk Tuk, and for any use outside your home network.

**Why:** browsers only show notifications to pages from a _secure context_:
an `https://` address, or `http://localhost` on the same computer. At
`http://mybox:8080` or `http://192.168.1.20:8080`, the browser hides the
Notification feature entirely, and **Settings → Reminder notifications** shows
it as unsupported. Everything else keeps working. Notifications only arrive
while a Tuk Tuk tab is open; a closed tab or locked phone gets none, even
over HTTPS.

Pick one way to get an `https://` address:

1. **Tailscale (easiest):** in the Tailscale admin console, under **DNS**,
   turn on MagicDNS and **HTTPS Certificates**. Then, on the computer running
   Tuk Tuk:
   ```sh
   tailscale serve --bg 8080
   ```
   The app is now at `https://<computer-name>.<tailnet>.ts.net`, with a real
   certificate, reachable only from your own devices.
2. **Your own domain:** run a reverse proxy such as [Caddy](https://caddyserver.com),
   which gets and renews a certificate by itself. A whole `Caddyfile`:
   ```
   tuk.example.com {
       reverse_proxy localhost:8080
   }
   ```
   The domain must point at the machine, and ports 80 and 443 must reach it.

Then, in `.env`:

1. Set `AUTH_COOKIE_SECURE=true`, so the session cookie is only sent over HTTPS.
2. Add the new `https://` address to `CORS_ORIGINS`, for example
   `CORS_ORIGINS=["http://localhost:8080", "https://mybox.tailnet-name.ts.net"]`.
3. Using Google Calendar? Add `https://<address>/api/v1/google/callback` as an
   authorized redirect URI too (see below).

Start the app again and open the `https://` address. **Settings → Reminder
notifications** should now offer **Enable on this device**.

## Optional: connect Google Calendar

⏱ 15 min, one time. Shows your Google events next to your tasks, read-only.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Calendar API**.
2. Set up the **OAuth consent screen** (type: External) and add yourself as a user.
   Then set **Publishing status** to **In production**. If you leave it on
   "Testing", Google disconnects you every 7 days.
3. Create credentials: **OAuth client ID → Web application**. Under
   **Authorized redirect URIs**, add one entry per address you use, each ending in
   `/api/v1/google/callback`. For example:
   `http://localhost:8080/api/v1/google/callback`
4. In Tuk Tuk, open **Settings → Google Calendar**. Paste the **Client ID** and
   **Client secret**, save, then connect your account.

Google warns that the app is unverified. That's expected for a personal app:
click **Advanced → Go to (your project)**.

Each redirect address must also be listed in `CORS_ORIGINS` (see above).

## Optional: enable voice

For hands-free Task and Habit changes, see [Set up the Voice Assistant](voice.md).
It needs a free LiveKit Cloud project and a separately deployed agent.

## Running on Kubernetes

For a cluster install with Flux and 1Password, see
[`backend/chart/README.md`](../../backend/chart/README.md).

## Next

→ [Upgrade and back up](upgrade.md)
