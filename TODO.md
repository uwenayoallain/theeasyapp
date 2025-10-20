# theeasyapp — Roadmap & Task Board

## Summary

- Minimal CSV viewer prioritizing load speed, streaming parse, and a virtualized grid.
- Bun-first runtime with TanStack Router, strict TypeScript, and shadcn/ui primitives.

## Core Commands

- Install: `bun install`
- Dev server: `bun dev`; Production: `bun start`
- Tests: `bun test`; file: `bun test src/lib/csvParser.test.ts`; focused: `bun test -t "Header|/regex/"`
- Types: `bunx tsc --noEmit`; Format: `bunx prettier --write .`
- Routes tooling: `bun run routes:watch` (dev), `bun run routes:generate` (build)
- Datasets: `bun run scripts/fetch-dataset.ts` (remote) | `bun run scripts/gen-synthetic.ts` (local fixtures)
- Avoid `bun run build` unless explicitly requested (CI/CD controlled).

## Current Status

- ✅ Virtualized grid with keyboard nav, column sizing, and selection metrics.
- ✅ Native CSV parser + worker pipeline for streaming ingestion.
- ✅ Sorting/filtering with persistence and initial profiling coverage.

## Active Initiatives

- Search UX: Ctrl+F overlay, highlight matches, next/prev navigation.
- Error UX: toast surface for validation failures, file type/size checks, URL guardrails.
- A11y: ARIA grid semantics, focus restoration, descriptive screen-reader labels.
- Worker lifecycle: backpressure safeguards (rowsBuffer bounds, pause/resume).
- Keyboard help: improve shortcuts overlay layout and consider a command palette.

## State & Persistence

- Persist sort, filters, column widths, and search to URL/localStorage.
- Shareable links for view state (filters/sort/search); safely avoid leaking local file paths.

## Backlog & Enhancements

- CSV dialect support: auto delimiter detection, robust quote/escape handling, regional formats.
- Import/export: remember recent files, copy selected rows to CSV/TSV, export filtered views.
- Column tooling: bulk hide/show, saved column layouts, pinned columns.
- Collaboration hooks: shareable URL state, persisted settings via local storage or Bun KV (investigate).

## Quality & Performance

- Benchmark 100k–500k row datasets; tune virtualization overscan and row height heuristics.
- Property-based + fuzz tests for parsers (`src/lib/csv*.ts`); add worker integration tests.
- Track render counts via React Profiler; watch for expensive reflows in grid interactions.
- CI polish: cache dependencies for Bun install; add README status badge.

## shadcn-first UI Policy

- Default to `src/components/ui/*` exports (Button, Input, Label, Select, Textarea, ContextMenu, Card).
- Extend via props/variants/`className`/`asChild`; avoid bespoke clones.
- For missing primitives, run `bunx shadcn@latest add <component>` and keep the addition stateless.

---

## Scalability & Performance Plan

Goal: Provide a consistent UX for all dataset sizes while scaling smoothly to very large datasets (100MB+ / 1M+ rows) via adaptive virtualization, background workers/WASM for heavy ops, and optional high‑performance rendering.

### Phase 1 — Quick UI wins (low‑risk)

- [ ] Add column virtualization (horizontal) and sync sticky header
- [ ] Replace giant selection `Set` with range‑based `SelectionModel` (`src/lib/selection.ts`)

### Phase 2 — Data windowing (decouple UI from full dataset)

- [ ] Create `src/workers/tableWorker.ts` to own dataset + filters/sorts + windowed slices
- [ ] Create `src/lib/dataSource.ts` and `src/hooks/useWindowedDataSource.ts` with LRU row cache
- [ ] Update `DataGrid` to accept `rowCount` and `rowsProvider(index)`; render placeholders for missing rows
- [ ] Stream clipboard exports from provider; avoid materializing giant selections

### Phase 3 — Heavy queries off‑main‑thread (WASM)

- [ ] Option A: Integrate DuckDB‑WASM for CSV/Parquet/Arrow SQL in worker
  - [ ] Ingest CSV via `read_csv_auto` into in‑memory DB; expose LIMIT/OFFSET slices
  - [ ] Implement filter/sort/search with SQL; return Arrow IPC to main thread
- [ ] Option B: Arrow + Arquero for columnar storage + transforms
- [ ] Lazy‑load bundles; route‑level code‑splitting to manage bundle size

### Phase 4 — Canvas/WebGL grid for extreme tables

- [ ] Add Glide Data Grid adapter `src/components/sheet/BigDataGrid.tsx`
- [ ] Toggle between DOM grid and Canvas grid in `Sheet`
- [ ] Optional: FINOS Perspective route for pivot/aggregation

### Phase 5 — Microsoft OSS analysis integrations

- [ ] Add SandDance exploration route `src/routes/explore.sanddance.tsx` (WebGL visual analytics)
- [ ] Add ONNX Runtime Web worker for in‑browser AI on filtered slices
- [ ] Optional: add Semantic Kernel (server) for agentic workflows over datasets

### Phase 6 — CSV robustness and backpressure

- [ ] Add UI backpressure: bound `rowsBuffer`; pause/resume worker when UI lags

### Phase 7 — Testing, tooling, rollout

- [ ] Add tests: `src/lib/dataSource.test.ts`
- [ ] Clipboard integration tests for copy/paste in grid (unit-level helpers)
- [ ] Add synthetic dataset generator and FPS/commit timing harness
- [ ] Add ESLint config + `bun run lint`; gate in CI

### Packages to evaluate (do not install in this task)

- DuckDB (WASM): `@duckdb/duckdb-wasm`
- Apache Arrow JS: `apache-arrow`
- Data transforms: `arquero`
- Canvas grid: `@glideapps/glide-data-grid`
- WebGL pivot grid: `@finos/perspective`, `@finos/perspective-viewer`, `@finos/perspective-viewer-datagrid`
- Microsoft SandDance: `@msrvida/sanddance`, `@msrvida/sanddance-react`, `vega`, `vega-lite`, `deck.gl`
- ONNX Runtime (web): `onnxruntime-web`

Install commands (repo default is Bun): `bun add <pkg...>`; if using pnpm: `pnpm add <pkg...>`

### References

- Microsoft SandDance — visual data exploration (WebGL): [GitHub](https://github.com/microsoft/SandDance)
- ONNX Runtime Web — in‑browser AI inference: [Docs](https://onnxruntime.ai/docs/execution-providers/Web-EP.html)
- DuckDB‑WASM — SQL engine in the browser: [Docs](https://duckdb.org/docs/api/wasm/overview) · [GitHub](https://github.com/duckdb/duckdb-wasm)
- Apache Arrow JavaScript — columnar data: [Docs](https://arrow.apache.org/docs/js/)
- Arquero — dataframe library for JS: [GitHub](https://github.com/uwdata/arquero)
- Glide Data Grid — high‑perf canvas grid: [GitHub](https://github.com/glideapps/glide-data-grid)
- FINOS Perspective — WebGL analytics/pivot: [GitHub](https://github.com/finos/perspective)
- Microsoft Semantic Kernel — orchestration/agents: [GitHub](https://github.com/microsoft/semantic-kernel)
- Microsoft FLAML — efficient AutoML: [GitHub](https://github.com/microsoft/FLAML)

## Next — Findings From Code Audit (2025-10-20)

What’s confirmed working

- Virtualized grid (vertical) with keyboard navigation, edit (Enter/F2/Tab), cut/copy/paste, and visible-range selection shortcuts.
- Search UX: overlay via Ctrl/Cmd+F or /, in-cell highlight, next/prev via Ctrl/Cmd+G and Shift variants; focus and scroll-to-match wired.
- Columns: resize with persistence; context menu Autosize from visible sample.
- Sorting and per-column filters with debounced includes matching; state persisted to URL (TanStack Router) and localStorage.
- CSV ingestion: Web Worker streaming with batch ACK, progress bar, cancel; graceful fallbacks; toasts for success/error/cancel.
- Selection metrics: sum/avg/min/max with row/col counts in status bar.

Gaps and risks

- No horizontal (column) virtualization; potential wide-table perf costs.
- Backpressure: rowsBuffer is unbounded; no pause/resume handshake beyond ACK-after-flush. Memory risk on huge inputs.
- Selection model: Set<string> per-cell does not scale to massive ranges; range-based model needed.
- File/URL safety: minimal MIME/size checks; limited URL guardrails.
- Large exports: selection copy isn’t streaming; risks memory/time on big selections.
- A11y: ARIA grid present but needs deeper audit (roles/labels/focus management).
- Tests: missing worker integration and robust fuzz/property tests.
- CI: ensure Bun-focused workflow; lint already configured—enforce in CI.

Prioritized next steps (1–2 weeks)

- [ ] Backpressure & safety: bound rowsBuffer (e.g., 50k cells or N MB) and add pause/resume. Update worker and useCSVLoader handshake.
- [ ] Column virtualization: add horizontal virtualizer; keep sticky header; ensure autosize and context menu still work.
- [ ] SelectionModel: introduce range-based model (src/lib/selection.ts), update DataGrid operations and stats to consume ranges.
- [ ] File/URL validation: size/MIME checks; allowlist/validation for ?url; surface via toasts.
- [ ] Streaming export: implement provider-based streaming for copy/export to avoid full materialization.
- [ ] Tests: worker integration tests; selection range tests; parser fuzz/property tests; export tests for streaming.
- [ ] Perf harness: scripted datasets (100k–1M rows) and commit-time/FPS metrics; integrate with PerfHUD.
- [ ] A11y audit: verify ARIA roles, labels, focus restoration, screen reader flows.
- [ ] UX polish: add copy row/column actions; surface match counts in search bar; minor context menu refinements.

Notes

- Keep Bun-first stack; no package changes in this pass.
- If adding deps later, prefer `bun add`. If pnpm is required in your environment, use `pnpm add` consciously.
