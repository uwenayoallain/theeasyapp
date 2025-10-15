theeasyapp — Minimal, Fast CSV Spreadsheet Viewer (Plan)

Summary
- Build a single Sheet page that auto-loads large CSV (100k rows) and renders a virtualized grid with selectable cells and minimal dark UI.
- Prioritize performance: native parsing (~430ms for 100k rows = 232k rows/sec), virtualization, memoized cells, cell selection.

Dependencies (install with Bun)
- bun add motion @tanstack/react-virtual @tanstack/react-router @tanstack/react-query

Order of Operations
1. bun add motion @tanstack/react-virtual papaparse
2. Create components and worker files under src/... as above.
3. Update src/index.html title and src/App.tsx to mount Sheet.
4. Add static route in src/frontend.tsx for /data/sample.csv.
5. Generate or fetch dataset:
   - bun run scripts/fetch-dataset.ts
   - or bun run scripts/gen-synthetic.ts
6. Run bun dev and validate with “Sample” button; test URL and file inputs.
7. Tune virtualization (overscan, rowHeight) after profiling.

Checklist
[x] Install deps (TanStack Router, Query, Virtual, Motion)
[x] Create Sheet page with auto-loading grid
[x] Add native CSV parser (no dependencies, 430ms for 100k rows)
[x] Add /data/sample.csv route
[x] Generate 100k row dataset (26MB)
[x] Verify 100k rows smooth scroll with virtualization
[x] Add cell selection with visual feedback
[x] Integrate TanStack Router with file-based routing
[x] Add QueryClient for future data fetching
[x] Add keyboard navigation (arrow keys)
[x] Add sorting/filtering/resizing
[x] Add tests and profiling (initial)

Next
- Streaming CSV loader with Web Worker
- Progressive rendering (append rows in batches)
- Persist column widths and user prefs
- Implement simple search (Ctrl+F) highlight & jump
