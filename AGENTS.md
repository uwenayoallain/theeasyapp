# Repository Guidelines

## Project Structure & Module Organization

`src/index.tsx` runs the Bun server, API routes, and DuckDB bridge, and `src/frontend.tsx` hydrates the React UI. Views and primitives live in `src/pages/` and `src/components/`, shared hooks/utilities in `src/hooks/` and `src/lib/`, and CSV/DuckDB workers in `src/workers/`. Router definitions stay in `src/routes/` and the generated `src/routeTree.gen.ts`. Assets stay in `public/`, styles in `styles/globals.css`, and bundled output in read-only `dist/`.

## Build, Test, and Development Commands

- `bun install` — install dependencies when `package.json` or `bun.lock` changes.
- `bun dev` — runs `tsr watch` plus `bun --hot src/index.tsx` for HMR.
- `bun run build` — regenerates router files and bundles frontend/worker assets into `dist/`.
- `bun start` — serves the production build via `Bun.serve`.
- `bun run routes:generate` — manual TanStack Router regen after editing `src/routes/`.
- `bun test` — execute Bun/Vitest suites.
- `bunx tsc --noEmit`, `bunx eslint . --ext .ts,.tsx`, `bunx prettier --check .` — type, lint, and formatting gates.
- `bun run ci` — canonical pre-push pipeline (typecheck, tests, lint, format, router codegen).

## Coding Style & Naming Conventions

TypeScript strict mode with 2-space indentation is enforced. Components and files are PascalCase, hooks start with `use`, utilities stay camelCase, TanStack Router leaves follow `kebab-case.ts`, and worker entrypoints use `*-worker.ts`. Use `bunx eslint --fix` and `bunx prettier --write` to satisfy ESLint (`@typescript-eslint`, React, React Compiler) and Prettier. Keep Tailwind classes structured (layout → spacing → color) to minimize diffs.

## Testing Guidelines

Tests live next to the code they cover (mostly `src/lib/*.test.ts`) and run through Bun’s Vitest-compatible runner. Favor deterministic helpers over fixtures, assert on streamed batches and DuckDB responses, and add regression cases whenever a bug is fixed. Run `bun test` before committing and keep `bun run ci` green ahead of PRs.

## Commit & Pull Request Guidelines

Commits follow the Conventional pattern seen in history (`feat(sheet): …`, `style: …`). Subjects stay present-tense, scopes are optional but specific, and branch names mirror the type (`feat/duckdb-preview`). Pull requests should link issues, call out user-visible changes, list validation commands (include `bun run ci`), and attach screenshots or clips for UI updates.

## Configuration & Security Notes

Copy `.env.example` to `.env` for local overrides such as `DUCKDB_TMP_DIR` or thread counts. Never commit `.env`, downloaded CSVs, or secrets. DuckDB temp files live in `.duckdb-tmp`; clear it before archiving logs and redact dataset URLs or SQL when sharing diagnostics. Rotate credentials if a value leaks.
