# Dokploy deployment

One AWS EC2 box runs Dokploy and MySQL 8.4. Every app has a production deployment from `main` and a staging deployment from `develop`. Production uses the `illapa` database; staging uses `illapa_staging`. Both keep the `hack_the_andes_` table prefix.

## Domains

Production runs on `getillapa.com` (issue #7). Staging still uses the URLs configured in its Dokploy environment.

| Host | App | Notes |
| --- | --- | --- |
| `dash.getillapa.com` | Dashboard (`web`) | Built with `VITE_SERVER_URL=https://api.getillapa.com` |
| `api.getillapa.com` | Server | `illapa-compress@file` middleware; `BETTER_AUTH_URL=https://api.getillapa.com` |
| `getillapa.com` | Marketing (`illapa`) | `www` redirects to it |

- **DNS:** the zone is in Route 53, in the same AWS account as the box. Its A records point straight at the Elastic IP with no proxy in front. Let's Encrypt's HTTP-01 challenge needs that, and so does the rate limiting: it keys on the `x-real-ip` header that Traefik sets from the TCP peer (`CLIENT_IP_HEADER=x-real-ip`).
- **Origins:** the server's `ALLOWED_ORIGINS` must list `https://dash.getillapa.com` and `https://getillapa.com`.
- **Keep the dashboard and the API on one registrable domain.** The session cookies are `SameSite=None` and belong only to the API host. A dashboard served from another site makes them third-party cookies, and private windows drop them.
- **Old sslip.io hosts:** the previous production dashboard and marketing hosts 302 to their `getillapa.com` hosts through Dokploy redirects. That keeps old links, such as the pitch deck's QR code, working. Their builds call `api.getillapa.com`, so they can't be served from the old host directly.

## Static sites

Build with the repository root as the context. Both images serve static files through nginx on port `80`. Dokploy runs one app per environment for each site; build a separate image with that environment's public URLs.

| Site | Dockerfile | Build args |
| --- | --- | --- |
| Dashboard (`web`) | `deploy/web.Dockerfile` | `VITE_SERVER_URL` |
| Marketing (`illapa`) | `deploy/illapa.Dockerfile` | `PUBLIC_APP_URL` (dashboard origin), `PUBLIC_API_URL` (API origin) |

The URLs are baked in at build time. Every listed build arg is required and must be nonempty; the Docker build stops with the missing variable name instead of falling back to `.env.production`. Direct `pnpm --filter web build` still loads Vite's `.env.production` fallback; `env.public.ts` rejects an empty URL when the browser loads the module, not while Vite bundles it. Use the Dockerfiles for deployment builds with required args. The marketing form posts to `${PUBLIC_API_URL}/api/demo-requests` on the API server; include the marketing origin in that server's `ALLOWED_ORIGINS`.

## Node services

`server`, `scraper` and `fleet-sync` run as plain Node 24 processes. Each app gets its own Docker image, built from `deploy/node-service.Dockerfile` with `APP=<app>`, and Dokploy serves it behind Traefik. Alchemy remains only for the local Workers dev runtime, which still needs the `cloudflare-franz` profile.

## How the Node build works

- `apps/<app>/src/node.ts` serves the Worker's default export through `@hack-the-andes-project/node-runtime`, using `@hono/node-server` for HTTP and `croner` for the cron triggers.
- `apps/<app>/tsdown.node.config.ts` bundles the app and all of its dependencies into `dist-node/`. The bundle swaps three Workers-only modules for Node versions (`packages/node-runtime/src/bundle-aliases.ts`):
  - `cloudflare:workers`: `env` is `process.env`. `HYPERDRIVE` is parsed from `DATABASE_URL`. The scraper's `SELF` binding calls back into the same process on `127.0.0.1:$PORT`.
  - `evlog/workers`: one JSON line per event on stdout.
  - `createDb`: closes the per-request MySQL connection when its request or cron run finishes. workerd does this on its own; Node does not.
- The server bundle also copies `packages/db/src/migrations` into `dist-node/migrations`, and the server applies the pending ones before it listens. A failed migration stops the boot, so the deploy fails instead of serving the new code against the old schema. scraper and fleet-sync never migrate.
- The image does not run varlock, so `.env.schema` defaults do not apply. Set every variable below. Only `DATABASE_URL` is checked at boot; any other missing variable fails the first request that needs it.

## Build and run

| | |
| --- | --- |
| Dockerfile | `deploy/node-service.Dockerfile`, with the repository root as build context |
| Build arg | `APP=server`, `APP=scraper` or `APP=fleet-sync` |
| Start command | the image `CMD`, `node node.mjs` in `/app` |
| Port | `3000`, set as `PORT` and exposed by the image |
| Health check | `GET /` answers `OK` |

```sh
docker build -f deploy/node-service.Dockerfile --build-arg APP=server -t illapa-server .
```

To run without Docker, use `pnpm --filter <app> build:node`, then `pnpm --filter <app> start:node` with the variables below exported. `PORT` defaults to 3000.

## Environment

Set these values on each app in Dokploy for its environment. The images do not read the checkout's `.env` or `.env.production` files. `DATABASE_URL` selects `illapa` in production or `illapa_staging` in staging, with any special characters in the user or password percent-encoded. `SERVICE_VERSION` is optional. When set (to the commit, for example), it is the build identity on every log event.

### server

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | see above |
| `APP_ENV` | yes | `production` |
| `BETTER_AUTH_URL` | yes | public API origin configured for this environment |
| `BETTER_AUTH_SECRET` | yes | at least 32 characters |
| `ALLOWED_ORIGINS` | yes | comma-separated browser origins; `*` matches inside one host label |
| `CREDENTIALS_ENCRYPTION_KEY` | yes | the same key as fleet-sync in this environment |
| `OSRM_BASE_URL` | yes | `https://router.project-osrm.org` |
| `CLIENT_IP_HEADER` | yes | `x-real-ip` behind Traefik; use `cf-connecting-ip` behind Cloudflare |
| `TILES_API_URL` | yes | origin of the tiles backend (`services/tiles`), proxied to engineers under `/tiles-api/*` (only `/tiles/*`, `/capas`, `/salud`) |
| `WEATHER_API_URL` | yes | origin of the weather backend (`services/weather`), proxied to engineers under `/weather-api/*` (only `/api/*`) |
| `DEMO_RESET_SECRET` | no | at least 32 characters; leave it unset to keep `POST /api/demo/reset` off |
| `ATOMICMEMORY_API_URL` | no | `https://api.atomicstrata.ai`; with `ATOMICMEMORY_API_KEY` it turns on the operators' route notes |
| `ATOMICMEMORY_API_KEY` | no | Atomic Memory Cloud project API key; leave either value unset to keep route notes off |
| `SERVICE_VERSION` | no | |

### scraper

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | see above |
| `APP_ENV` | yes | `production` |
| `SCRAPER_RUN_SECRET` | yes | at least 32 characters; the `x-scraper-secret` header of `POST /run` and `POST /risk` |
| `JEV_API_KEY` | yes | TypeSafe (Jev) key that classifies the news |
| `B2_MEDIA_KEY_ID` | yes | Backblaze B2 key for the `illapa-media` bucket |
| `B2_MEDIA_APPLICATION_KEY` | yes | Backblaze B2 key for the `illapa-media` bucket |
| `SRATMA_RELAY_URL` | on AWS | origin of the SRATMA relay below; empty means calling SRATMA directly |
| `SERVICE_VERSION` | no | |

Crons, in UTC: `*/5 * * * *`, `0 * * * *` and `0 9 * * *` (from `packages/infra/constants.ts`).

#### SRATMA relay

SRATMA (`sratma.mtc.gob.pe`) drops connections from AWS but answers Cloudflare, so on Dokploy the scraper reaches it through `deploy/sratma-relay/worker.js`, a Cloudflare Worker with no dependencies. It relays only GETs under `/wssratma/api/Mapa/`, and only for the client IPs in its `ALLOWED_CLIENT_IPS` plain-text variable (the Dokploy box's Elastic IP). Set the scraper's `SRATMA_RELAY_URL` in Dokploy to the relay Worker's origin.

### fleet-sync

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | see above |
| `APP_ENV` | yes | `production` |
| `FLEET_SYNC_RUN_SECRET` | yes | at least 32 characters; the `x-fleet-sync-secret` header of `POST /run` |
| `CREDENTIALS_ENCRYPTION_KEY` | yes | 44-character base64 key, the same one as the server |
| `OSRM_BASE_URL` | yes | `https://router.project-osrm.org` |
| `SERVICE_VERSION` | no | |

Cron, in UTC: `*/2 * * * *`.

## Simulator backends

`services/tiles` (Peru terrain tiles) and `services/weather` (NOAA GFS, GLM lightning and GOES-19 clouds) are Python services that only the server calls, through its engineer-only `/tiles-api/*` and `/weather-api/*` routes. They have no authentication of their own, so do not give them a public domain. Run each one as a Dokploy app on the same network as the server, and point the server at their internal hostnames.

| | tiles | weather |
| --- | --- | --- |
| Dockerfile | `services/tiles/Dockerfile` | `services/weather/Dockerfile` |
| Build context | repository root | repository root |
| Port | `8080` | `8787` |
| Health check | `GET /salud` | `GET /api/health` |
| Volume | `/data/tiles` with `fs` storage, none with S3 | `/data/cache` (GFS, GLM and cloud cache) |
| Server variable | `TILES_API_URL=http://<tiles app name>:8080` | `WEATHER_API_URL=http://<weather app name>:8787` |

- tiles: set `TILES_STORAGE=s3` with `TILES_S3_ENDPOINT`, `TILES_S3_BUCKET`, `TILES_S3_ACCESS_KEY`, `TILES_S3_SECRET_KEY` (R2 or S3), and `TILES_CONTACT`. Without S3, keep the default `TILES_STORAGE=fs` and mount a volume at `/data/tiles` (the image's `TILES_FS_ROOT`, owned by the service user). All variables are listed in `services/tiles/README.md`.
- weather: the defaults cover Peru. Run exactly one replica, because its pollers write to the cache volume. Variables are listed in `services/weather/README.md`.
- `services/docker-compose.yml` runs both services with MinIO locally (`docker compose -f services/docker-compose.yml up -d --build`). The server's local defaults already point at them.

## Operations

- Every instance runs the crons. Run exactly one replica of scraper and of fleet-sync per environment. Legacy Cloudflare application crons must stay disabled so they cannot write alongside the Node services.
- If a cron tick arrives while the previous run of that cron is still busy, it is skipped and logged as a `cron_skipped` warning. Runs of the same cron never overlap and missed ticks are not caught up.
- On SIGTERM a service stops its crons and stops accepting requests. It then waits up to 8 s for in-flight requests, cron runs and `waitUntil` work before it exits. Docker's default 10 s stop grace period covers that.
- `x-real-ip` holds the TCP peer that Traefik sees. If Cloudflare proxies in front of Traefik, set `CLIENT_IP_HEADER=cf-connecting-ip` and only accept origin traffic from Cloudflare. Otherwise a client that reaches Traefik directly could spoof that header.
- Node keeps idle keep-alive connections open for 95 s, longer than Traefik's 90 s idle timeout. Traefik therefore never reuses a connection that Node has already closed.
