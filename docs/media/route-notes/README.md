# Route notes: local demo evidence

Recorded on 2026-10-21 against the real app running locally, not a mock page:

- Server: the Node bundle (`pnpm --filter server build:node`, then `node dist-node/node.mjs`) on `127.0.0.1:4713`. It ran its migrations against a local MySQL 8.4 on `127.0.0.1:4714`.
- Dashboard: `apps/web` running on `vite dev` at `127.0.0.1:4718`, signed in through the real `/demo` flow.
- Atomic Memory: **`atomic-memory-demo-fixture.mjs`, a labelled local fixture, not Atomic Memory Cloud.** It runs on `127.0.0.1:4716` and implements only the routes the feature calls (`POST /v1/memories/ingest/quick`, `GET /v1/memories/by-external-id/:id`, `DELETE /v1/memories/:id`).

| File | What it shows |
| --- | --- |
| `recalled-after-reload.png` | Revisar ruta, Lima → Huancayo: the saved note is read back from Atomic Memory after a page reload |
| `route-notes-flow.webm` | About 21 s: save, reload and recall, correct, reload, delete, reload to an empty form |
| `memory-down-unavailable.png` | With the fixture stopped, the card says the note could not be read, and route review still works |

The browser was started with `agent-browser --init-script hide-devtools-for-capture.js`. That script hides only the dev-mode TanStack Router and TanStack Query devtools toggles: buttons whose aria-label, title or text matches TanStack devtools, plus the wrapper that holds nothing but the Query devtools button. Product content is untouched, and production builds don't include those devtools anyway.
