# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fast spreadsheet-style CSV explorer built on Bun end-to-end. Streams massive CSV files through Web Workers with optional DuckDB backend for SQL queries and incremental previews. Uses TanStack Virtual for virtualized grid rendering and TanStack Router for URL-shareable state.

## Essential Commands

### Development

```bash
bun install                    # Install dependencies
bun dev                        # Start dev server (HMR + TanStack Router watch)
bun start                      # Start production server
```

### Testing & Quality

```bash
bun test                       # Run all tests
bun test src/lib/csvParser.test.ts  # Run specific test file
bunx tsc --noEmit             # Type check without building
bunx eslint . --ext .ts,.tsx  # Lint TypeScript/React files
bunx prettier --check .       # Check formatting
bun run ci                    # Full CI pipeline (types, tests, lint, format, routes)
```

### Building

```bash
bun run build                 # Build for production (generates routes + bundles to dist/)
bun run routes:generate       # Regenerate TanStack Router files manually
```

**IMPORTANT**: The user has a dev server running continuously. Never run `bun run build` or `bun dev` unless explicitly requested.

## Architecture Overview

### Data Flow: Two Modes

**Client-only mode** (`type: "csv"`):

- Web Worker (`src/workers/csvWorker.ts`) streams CSV via `src/lib/streamingCSV.ts`
- Batches sent to main thread, filters/sorts run client-side
- Used for local file drops or remote URLs without DuckDB

**DuckDB mode** (`type: "duckdb"`, default):

- Backend (`src/index.tsx` Bun.serve) loads CSV into DuckDB (`src/lib/duckdb.ts`)
- Frontend requests chunked previews via `/api/db/preview` for virtual scrolling
- Edits persisted back via `/api/db/mutate`
- Supports sample dataset, uploaded files, or remote URLs

### Backend Server (`src/index.tsx`)

Single Bun.serve entry point that:

- Serves the SPA (HTML imports with automatic React/CSS bundling)
- On-the-fly Worker bundling (`/workers/csv-worker.js`, `/workers/table-worker.js`)
- DuckDB API routes:
  - `POST /api/db/load` — hydrate DuckDB from file/URL
  - `GET /api/db/preview` — paginated chunks for virtual scrolling
  - `POST /api/db/query` — read-only SQL queries
  - `POST /api/db/mutate` — persist cell edits
- HMR + console proxying in development

**Key detail**: Workers are bundled dynamically at runtime in dev, prebuilt in production.

### Frontend State Management

**TanStack Router** manages URL state for shareable sessions:

- `?url=duckdb:dataset` — sample dataset
- `?url=duckdb:url=<encoded>` — remote CSV loaded into DuckDB
- `?url=<direct-url>` — client-only streaming mode
- Sort/filter/search state also encoded in URL params

**Core hooks**:

- `useCSVLoader` — orchestrates loading, streaming, and DuckDB preview fetching
- `useSheetSort`, `useSheetFilters`, `useSheetSearch` — URL-synced grid interactions
- `useSheetKeyboardShortcuts` — global keyboard navigation

### Component Structure

**`src/pages/Sheet.tsx`**:

- Main orchestrator: loads data, applies filters/sort/search, manages selection
- Computes `viewRows` by filtering/sorting `rows` (client-only mode) or passes through DuckDB chunks (streaming mode)
- Maps view row indices to absolute row indices for edits

**`src/components/sheet/DataGrid.tsx`**:

- TanStack Virtual-powered virtualized grid
- In-cell editing, selection, context menu, clipboard ops (copy/paste/cut)
- Column resizing with localStorage persistence
- Keyboard navigation (arrows, Home/End, PageUp/PageDown, Ctrl+Arrow jumps)

**`src/components/sheet/SearchOverlay.tsx`, `ShortcutsHelp.tsx`**:

- Overlay UI for search (Ctrl/Cmd+F or `/`) and keyboard reference (`?`)

### DuckDB Integration (`src/lib/duckdb.ts`)

- Single in-memory DuckDB instance with connection pooling
- Promise queue ensures serialized access (prevents concurrent write corruption)
- CSV loading via `read_csv_auto()`, parameterized queries via prepared statements
- Temp file handling for blob/URL sources (cleanup in `finally`)
- Row updates use `rowid` for stable addressing

**Important**: DuckDB connection is shared across requests; mutations are transactional (BEGIN/COMMIT/ROLLBACK).

### Web Workers

**`src/workers/csvWorker.ts`**:

- Streams CSV from File or URL via `src/lib/streamingCSV.ts`
- Backpressure via `waitForAck()` after each batch
- Pause/resume support, abort handling

**`src/workers/tableWorker.ts`**:

- DuckDB preview fetching in background (future optimization)

### Streaming CSV Parser (`src/lib/streamingCSV.ts`)

- Incremental UTF-8 decoding with TextDecoder stream
- Handles quoted fields, multiline values, escaped quotes
- Emits batches to avoid blocking main thread
- Progress tracking via byte counts

### UI Components (`src/components/ui/`)

shadcn/ui-style primitives (button, input, select, context-menu, etc.) built on Radix UI. Keep these stateless and reusable. Grid-specific components live under `src/components/sheet/`.

## Testing Strategy

- Unit tests co-located (e.g., `src/lib/csvParser.test.ts`, `src/lib/duckdb.test.ts`)
- Focus on edge cases: multiline CSV fields, filter predicates, selection math, DuckDB query safety
- Integration tests for streaming behavior (backpressure, abort, pause/resume)
- Run `bun test` before commits, `bun run ci` before PRs

## Key Configuration Files

- `tsr.config.json` — TanStack Router codegen (outputs to `src/routes/`)
- `.eslintrc.cjs` — ESLint + React Compiler rules
- `tailwind.config.css` — Tailwind v4 config (imported in CSS, not separate JS file)
- `build.ts` — Custom Bun build script with CLI args (used by `bun run build`)

## Common Patterns

### Path Aliasing

Use `@/` for imports (mapped via `tsconfig.json`):

```ts
import { parseStream } from "@/lib/streamingCSV";
import { DataGrid } from "@/components/sheet/DataGrid";
```

### Async Error Handling

Wrap async operations in try-catch, log to console, show toast to user:

```ts
try {
  await loadSource({ type: "duckdb", url: trimmed });
} catch (err) {
  console.error("Failed to load CSV:", err);
  showToast({
    variant: "error",
    title: "Load failed",
    description: err.message,
  });
}
```

### DuckDB Query Safety

- Always use parameterized queries for user input
- Escape identifiers with `escapeIdentifier()`, literals with `escapeLiteral()`
- Whitelist read-only queries (enforce `SELECT` only for `/api/db/query`)

### Worker Communication

- Workers post `{ type, ...payload }` messages
- Main thread ACKs batches to apply backpressure
- Always handle `AbortError` gracefully (expected cancellation path)

## TanStack Router Route Generation

Routes defined in `src/routes/` (e.g., `__root.tsx`, `index.tsx`). Run `bun run routes:generate` or `bun run ci` after adding/modifying routes. Never edit `routeTree.gen.ts` manually.

## Development Tips

- **Performance HUD**: Add `?perf=1` to URL or set `localStorage["dev.perf"]="1"` to show render timings
- **DuckDB logs**: Open DevTools > Network to inspect `/api/db/preview` responses if grid stalls
- **Column widths**: Persisted to localStorage under `sheet.columns.widths`
- **Keyboard shortcuts**: Press `?` in the app to open reference overlay

## Commit Conventions

Follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.). Keep commits focused for surgical reverts. See `AGENTS.md` for contributor checklist.

## Security Notes

- Never commit secrets (DuckDB creds, API keys, etc.)
- Only `BUN_PUBLIC_*` env vars are safe for client bundle
- Audit `/api/db/query` for SQL injection (currently enforces SELECT-only)
- Temp files cleaned up in `finally` blocks (see `src/lib/duckdb.ts`)
