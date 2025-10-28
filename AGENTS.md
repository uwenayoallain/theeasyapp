# Repository Guidelines

This repository powers a Bun + TanStack Router app. Keep changes focused, lean on the existing automation, and document anything that impacts other contributors.

## Project Structure & Module Organization

- App source lives in `src/`, with UI components under `src/components`, hooks in `src/hooks`, and shared utilities in `src/lib` and `src/data`.
- Routes are defined in `src/routes` and backed by the generated `src/routeTree.gen.ts`; never edit generated artifacts directly.
- Co-locate tests as `*.test.ts[x]`, store static assets in `public/`, and treat `dist/` as throwaway build output.

## Build, Test, and Development Commands

- `bun install` installs dependencies; CI uses `bun install --frozen-lockfile` to pin versions.
- `bun dev` starts the dev server with HMR and regenerates the TanStack route tree.
- `bunx tsc --noEmit` enforces strict typing without emitting artifacts.
- `bun test` runs the Vitest suite; filter via `bun test src/lib/csvParser.test.ts -t "edge case"`.
- `bunx eslint . --ext .ts,.tsx` and `bunx prettier --check .` keep linting and formatting consistent; add `--write` locally when fixing issues.
- `bun run ci` stitches together type check, tests, lint, format check, and router generation for a pre-PR smoke test.

## Coding Style & Naming Conventions

Write modern ESM TypeScript. Import types with `import type`, prefer the `@/` alias for internal modules, and follow PascalCase for components/hooks, camelCase for functions/variables, and UPPER_SNAKE_CASE for constants. Rely on Prettier defaults; avoid inline lint disables unless documented. Keep components pure, especially under `src/components/ui/*`, and wrap stable callbacks in `useCallback` when refs depend on them.

## Testing Guidelines

Vitest powers the suite. Mirror filenames (`src/lib/parser.ts` → `src/lib/parser.test.ts`) and aim for meaningful coverage on parsing, filtering, and DuckDB integration paths. Favor integration-style tests for router flows and target edge cases like streaming failures. Run `bun test` before every commit.

## Commit & Pull Request Guidelines

Use Conventional Commit prefixes (e.g., `feat:`, `fix:`, `chore:`) and keep commits surgical so reverts stay easy. Before raising a PR, ensure `bun run ci` passes, summarize behavior changes, link issues, and attach UI screenshots or recordings when applicable. Call out follow-up tasks and note any schema shifts.

## Security & Configuration Tips

Never commit secrets. Only expose environment variables prefixed with `BUN_PUBLIC_` to the client bundle. When routes change, regenerate TanStack files via `bun run ci` or `bun run build` instead of hand-editing generated code. Treat `AbortError` as an expected cancellation path and prefer `console.warn` for ignored failures.
