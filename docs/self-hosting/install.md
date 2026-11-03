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
2. Create the master key (one time only):
   ```sh
   echo "APP_MASTER_KEY=$(openssl rand -base64 32)" > .env
   ```
3. Build and start it:
   ```sh
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. Open **http://localhost:8080** and choose your password.

The app builds on your own machine, so it runs on Intel/AMD and Apple Silicon (M1 to M4) alike.

> **Back up `.env`.** The master key in it encrypts your saved Google and AI
> credentials. If you lose it, you'll have to enter those again. Your tasks are
> not affected. See [Security](security.md#the-master-key).

## Everyday commands

Run these from the `tuk-tuk` folder.

| To… | Run |
| --- | --- |
| Stop | `docker compose -f docker-compose.prod.yml down` |
| Start | `docker compose -f docker-compose.prod.yml up -d` |
| See logs | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Check it's running | `docker compose -f docker-compose.prod.yml ps` |

The app restarts by itself after a reboot as long as Docker is running. Your data
lives in a Docker volume called `tuk-tuk-prod_data` and survives `down`.

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
> your password and session travel unencrypted. Put the app behind HTTPS (for
> example `tailscale serve`, or a reverse proxy such as Caddy), then set
> `AUTH_COOKIE_SECURE=true` in `.env`. Never expose it to the internet over plain http.

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

## Running on Kubernetes

For a cluster install with Flux and 1Password, see
[`backend/chart/README.md`](../../backend/chart/README.md).

## Next

→ [Upgrade and back up](upgrade.md)
