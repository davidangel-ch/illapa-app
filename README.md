# hack-the-andes-project

pnpm monorepo: Hono + oRPC API (`apps/server`), Vite dashboard (`apps/web`), Astro marketing site (`apps/illapa`), Expo app (`apps/native`), scraper and fleet-sync services, better-auth, Drizzle + MySQL 8.4, and evlog wide-event logging. Production and staging run on one AWS EC2 box with Dokploy: Node 24 services and nginx static sites.

## Product docs

[Project brief](docs/project_brief.md) · [MVP PRD](docs/prd.md) · [Design system](docs/DESIGN.md)

## Setup

1. `pnpm install` (generates the typed env files from every `.env.schema`).
2. Secrets (gitignored):
   - `apps/server/.env` → `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), and optionally `DEMO_RESET_SECRET` to enable the demo reset
   - `apps/server/.env` → optionally `ATOMICMEMORY_API_URL` and `ATOMICMEMORY_API_KEY` to turn on [route notes](#route-notes-optional-atomic-memory)
   - `packages/db/.env` → `DATABASE_URL` for your own MySQL 8.4, for example a local Docker `mysql:8.4` instance
   - `apps/server/.env` and `apps/fleet-sync/.env` → the same `CREDENTIALS_ENCRYPTION_KEY` (`openssl rand -base64 32`)
   - `apps/fleet-sync/.env` → `FLEET_SYNC_RUN_SECRET` (`openssl rand -base64 32`)
   - `apps/scraper/.env` → `SCRAPER_RUN_SECRET` (`openssl rand -base64 32`), `JEV_API_KEY`, and `B2_MEDIA_KEY_ID` / `B2_MEDIA_APPLICATION_KEY` (B2 key scoped to the `illapa-media` bucket)
3. `pnpm infra:login` once to connect the `cloudflare-franz` Alchemy profile (`pnpm infra:refresh` when the token expires).
4. `pnpm db:migrate` to create the `hack_the_andes_*` tables in your local database.
5. `pnpm dev` starts Alchemy's local Workers runtime. It still needs the `cloudflare-franz` profile; a Node dev script will replace it later.

For local dev, Varlock loads `.env.schema` defaults and gitignored `.env` values, selecting `.env.production` when `APP_ENV=production`. Dokploy supplies Node env values directly and static-site URLs as build args; Node images do not run Varlock or apply schema defaults.

## Database changes

Schema changes ship as versioned migrations in `packages/db/src/migrations`, one folder per change, applied in name order and recorded in the `__hack_the_andes_migrations` table.

1. Change the tables in `packages/db/src/schema`.
2. `pnpm db:generate --name <change>` writes the migration. Commit it with the schema change; never edit it by hand.
3. `pnpm db:migrate` applies it to your local database.
4. After rebasing onto a branch that brought its own migrations, run `pnpm db:generate` again. It stops with "Non-commutative migrations detected" when two branches changed the same thing; drop your migration, regenerate it on top, and commit that.

On Dokploy the server applies pending migrations before it starts listening, so staging migrates when `develop` deploys and production when `main` does. A local database created with `db:push` before migrations existed has no history: drop it and run `pnpm db:migrate`. Keep `db:push` for throwaway databases.

## Production domains and deployment

Dokploy deploys production when `main` changes and staging when `develop` changes. Each app has one deployment per environment. Server, scraper and fleet-sync use `deploy/node-service.Dockerfile` with `APP=<app>`; dashboard and marketing use their nginx Dockerfiles. Each environment has its own env values and static-site URL build args. MySQL holds `illapa` (production) and `illapa_staging`.

Production runs on `getillapa.com`: the dashboard at https://dash.getillapa.com (judges start at `/demo`), the API at https://api.getillapa.com and the marketing site at https://getillapa.com. Staging still uses the URLs configured in its Dokploy environment. See [the deployment runbook](deploy/README.md) for the domains, build args, env values, the SRATMA relay and operations.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | `alchemy dev`: server :3000, web :3001, scraper :3002, fleet-sync :3003; local Hyperdrive uses `DATABASE_URL` |
| `pnpm dev:web` / `pnpm dev:illapa` | Dashboard alone / marketing through Alchemy |
| `pnpm infra:login` / `pnpm infra:refresh` | Configure / refresh the Alchemy profile required by local dev |
| `pnpm dev:native` | Expo dev server |
| `pnpm build` / `pnpm check-types` / `pnpm test` | Build, type-check and test every package |
| `pnpm build:native:android` / `:ios` | Local EAS build (preview profile) |
| `pnpm build:native:cloud:android` / `:ios` | Remote EAS build (preview profile) |
| `pnpm build:native:prod:android` / `:ios` | Remote EAS production build |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | drizzle-kit against `DATABASE_URL` (see Database changes) |
| `pnpm demo:reset` | Wipe and reseed the shared demo account (see Demo access) |

## Auth

Every server route requires a session except `/`, `/api/auth/*`, public `POST /api/demo-requests`, the secret-guarded `/api/demo/reset` and the procedures listed in `PUBLIC_PROCEDURE_PATHS`. Browser origins allowed for CORS and better-auth come from the comma-separated `ALLOWED_ORIGINS`.

## Demo access

"Probar demo" on the marketing site opens `/demo` on its configured dashboard URL, which signs the visitor into the shared `demo@illapa.app` account through `/api/auth/demo/sign-in` (no password, 120 sign-ins per minute per IP) and seeds its demo fleet and two demo trips on first use. A visitor already signed in with their own account is asked before the demo replaces it: they can keep that account or sign out and open the demo. The endpoint itself refuses (409) to replace a real account's session. Once every trip of the demo account is completed or cancelled, the next fleet-sync run or `/demo` visit restarts the demo with the same wipe and reseed as the reset below. The demo account cannot change its email, password, sessions or organization, and can only add demo GPS connections.

The reset endpoint is off unless the server has `DEMO_RESET_SECRET` set (add it before deploying when you need it). To restart it on demand, for example while a trip is still running, use `DEMO_RESET_SECRET=… DEMO_RESET_URL="$API_URL/api/demo/reset" pnpm demo:reset` (`API_URL` is the target environment's API origin). Without `DEMO_RESET_URL` it targets the local server. It deletes the demo organization's alerts, trips, vehicles and connections and seeds them again.

## Route notes (optional, Atomic Memory)

On **Revisar ruta** and on a trip's page, an operator can keep one short reviewed note per origin → destination pair, such as "Neblina en Ticlio antes de las 6:00". It only shows to that operator. It is saved only after they tick the consent box, they can correct or delete it, and it never changes the risk index or the recommendation.

The notes are off until `apps/server/.env` has both `ATOMICMEMORY_API_URL` and `ATOMICMEMORY_API_KEY`. That can be Atomic Memory Cloud (`https://api.atomicstrata.ai` with a project API key) or a local Atomic Memory Core (`http://127.0.0.1:17350` with its `CORE_API_KEY`). The URL must be HTTPS (plain HTTP only on `127.0.0.1`, `localhost` or `[::1]`) with no user, password, query or fragment; requests never follow redirects. A bad or partial value only turns the notes off and adds `routeNotes.config: "invalid"` to the request log; the server still starts. When either value is missing, the card does not show, and route review, trips and alerts work as before. The card is also skipped when Atomic Memory is slow or down: it says the note could not be read, and route review still works.

- Each note is stored under the signed-in user and organization (`illapa:<organizationId>:<userId>`). The shared demo account stores notes under the visitor's session (`illapa-demo-session:<sessionId>`), so the next visitor never sees them.
- Each note has the external id `illapa-route-note:<subject>:<origin>:<destination>`. A correction re-ingests that id (`POST /v1/memories/ingest/quick`, verbatim with `skip_extraction`), and notes are read and deleted by that id (`GET /v1/memories/by-external-id/…`, `DELETE /v1/memories/:id`), never through semantic search.
- A save is reported only when Atomic Memory returns the stored or updated record id and the same text reads back. Otherwise the operator is told it could not be confirmed. A deletion is reported only once the note no longer reads back. Each operation, including its readback, gets one 4-second budget. Local demo evidence (screenshots and video) is in [docs/media/route-notes](docs/media/route-notes/README.md).

## Dashboard and fleet tracking

The dashboard combines incident feeds with organization-scoped Geotab and Samsara vehicles, trips, ETAs, and hazard alerts. The fleet-sync Node service polls GPS providers every two minutes; shared rules live in `packages/business`.

See the [dashboard plan and operations notes](docs/dashboard-plan.md), [fleet-sync runbook](apps/fleet-sync/README.md), and [business module map](packages/business/README.md).

## Predictive risk engine

Illapa scores road segments for the risk of rain-triggered hazards (huaicos, landslides, floods) and compares routes by exposure. The pilot is the Carretera Central, Lima–Huancayo (PE-22).

- **Offline pipeline** ([`tools/risk-pipeline`](tools/risk-pipeline/README.md), Python):
  - It builds the road graph from the Geofabrik OpenStreetMap extract and cuts it into segments of about 1 km.
  - It adds static features to each segment: Copernicus DEM slope, INGEMMET mass-movement and fluvial-flood susceptibility, and distance to rivers.
  - It loads everything into the `hack_the_andes_road_*` tables.
- **Hourly scoring:** the scraper's hourly cron calls `POST /risk`. It combines Open-Meteo rain (last 72 h plus the 24/48/72 h forecast), nearby historical landslides and floods, and active SENAMHI, INDECI and SUTRAN alerts into a 0–100 score per segment and horizon (`hack_the_andes_segment_risk_assessment`).
- **API:**
  - `risk.segments` lists segments with their latest assessment.
  - `risk.compareRoutes` runs A* over the graph twice: once for the fastest route and once with a risk penalty. SUTRAN `interrumpido` closures are hard constraints, and when no route exists it returns the official SUTRAN detours.
- **Optional model:** `train.py` trains a LightGBM model on INDECI COEN events and exports it to the shared business package only if it beats the heuristic on every held-out route. The last run did not (28 positive segment-days), so the heuristic is active.

Scores are relative indices that support decisions, not calibrated probabilities. Every response carries a disclaimer and the assessment timestamps. When the weather fetch fails, the previous assessment is kept rather than scored as dry.

To load the pipeline locally: `pnpm db:migrate`, then `uv run python -m illapa_risk.build` and `uv run python -m illapa_risk.load` in `tools/risk-pipeline`. After that, trigger a scoring run with `POST http://localhost:3002/risk` (header `x-scraper-secret`).
