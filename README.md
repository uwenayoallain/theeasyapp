# theeasyapp

Fast spreadsheet-style exploration of very large CSV files. The app runs on Bun end‑to‑end, streams data through Web Workers, and can optionally hydrate DuckDB to enable SQL queries and incremental previews.

---

## Highlights

- **Massive CSV support** – streams from local files or remote URLs without blocking the UI. Workers keep the main thread responsive while batches hydrate the grid.
- **Virtualized grid** – TanStack Virtual + keyboard friendly interactions give smooth scrolling across 100k+ rows with column resize persistence and selection analytics.
- **DuckDB integration** – upload or point to a URL and the Bun backend loads it into DuckDB. The front end requests preview chunks and keeps them in sync with edits.
- **URL-shareable state** – sort order, filters, search queries, and dataset choices live in the router search params so sessions can be shared or reloaded.
- **Quality gates** – strict TypeScript, ESLint (React compiler rules included), Prettier, Vitest, and TanStack Router codegen are wired into `bun run ci`.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- DuckDB is bundled; no external service required.

### Install

```bash
bun install
```

### Run in Development

```bash
bun dev
```

The command runs:

- `tsr watch` for TanStack Router file generation
- `bun --hot src/index.tsx` for the Bun server (frontend + API) with HMR

Visit <http://localhost:3000>.

### Production Build & Serve

```bash
bun run build   # generates routes and bundles assets to dist/
bun start       # serves the production build with Bun.serve
```

### Quality & Tooling

- Type check: `bunx tsc --noEmit`
- Unit tests: `bun test`
- Lint: `bunx eslint . --ext .ts,.tsx`
- Format: `bunx prettier --check .`
- Full pipeline (what CI runs): `bun run ci`

---

## CSV Ingestion Modes

| Mode                    | When it’s used                                                                | Experience                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Client-only parsing** | Drop a local CSV or load a URL without DuckDB (`type: "csv"`).                | Worker parses the file, streams batches into the grid, filters & sorts run client-side.                                        |
| **DuckDB streaming**    | Default when `type: "duckdb"` (sample dataset, uploaded file, or remote URL). | Backend loads into DuckDB, exposes `/api/db/preview` for chunked virtual scrolling, persists edits back with `/api/db/mutate`. |

The active dataset is tracked in the route search param `url`. Examples:

- `?url=duckdb:dataset` – built-in sample set
- `?url=duckdb:url=https%3A%2F%2Fexample.com%2Ffile.csv` – remote load
- `?url=https%3A%2F%2Fexample.com%2Fsmall.csv` – client-only mode

Filters, search query, and sort state are also encoded in the URL for shareable sessions.

---

## Keyboard Reference

| Action           | Keys                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Navigate         | Arrow keys, Home/End, PageUp/PageDown                                                           |
| Jump to edges    | Ctrl/Cmd + Arrow                                                                                |
| Edit cell        | Enter / F2 (Tab & Shift+Tab commit & move)                                                      |
| Selection        | Shift+Arrow extends, Esc clears, Shift+Space selects row, Ctrl/Cmd+Space selects visible column |
| Clipboard        | Ctrl/Cmd+C copy, Ctrl/Cmd+V paste, Ctrl/Cmd+X cut                                               |
| Search           | Ctrl/Cmd+F or `/`; Enter / Shift+Enter cycle results                                            |
| Filters          | Ctrl/Cmd+Shift+F toggles filter row                                                             |
| Shortcut overlay | `?` opens the reference dialog                                                                  |

---

## Project Layout

```
src/
├─ index.tsx            # Bun.serve entry (frontend + API + DuckDB wiring)
├─ frontend.tsx         # Boots the React app
├─ pages/Sheet.tsx      # Main grid page (sorting/filtering/search orchestration)
├─ components/          # UI primitives + grid modules
├─ hooks/               # App-specific hooks (filters, keyboard, search, CSV loader)
├─ lib/                 # CSV parsing, DuckDB client, selection math, utilities
├─ workers/             # CSV + DuckDB table web workers
└─ routes/              # TanStack Router definitions (generated files committed)
```

Supporting scripts live in `scripts/` (sample data fetch, synthetic dataset generation). Configuration files for Tailwind, ESLint, TanStack Router, and Bun sit at the repo root.

---

## DuckDB API Summary

All endpoints are served from the Bun process:

- `POST /api/db/load` — accepts JSON `{ url, table?, batchSize? }` or multipart form (`file`, optional `table`, optional `url`) to hydrate DuckDB.
- `GET /api/db/preview?table=dataset&offset=0&limit=2000` — returns `{ columns, rows, rowCount }` for virtualized paging.
- `POST /api/db/query` — run read-only SQL against the in-memory database.
- `POST /api/db/mutate` — persist edits or pastes back into the table.

Web workers keep the preview channel hot, and the client prefetches ahead of the viewport for smooth scroll.

---

## Testing & Debugging Tips

- Run `bun run ci` before opening a PR; it covers type checks, tests, lint, format, and regenerates TanStack Router files.
- Toggle performance HUD via `?perf=1` in the URL or `localStorage["dev.perf"]="1"` to watch commit timings and virtual row counts.
- DuckDB streaming state logs to the console when batches arrive; open DevTools > Network to inspect preview responses if the grid stalls.

---

## Contributing

1. Create a new branch with a Conventional Commit-style name (`feat/`, `fix/`, etc.).
2. Make your changes and update/add tests as needed.
3. Run `bun run ci`.
4. Open a PR summarising behaviour changes and include screenshots or screen recordings for UI tweaks.

See `AGENTS.md` for the condensed contributor checklist used by automation and AI assistants.

---

## License

This project is proprietary to its owner. Remove or replace this section if you intend to distribute under an open-source license.
