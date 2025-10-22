# Repository Guidelines

## Project Structure & Module Organization

The application lives under `src/`, with UI components in `src/components`, data utilities in `src/lib` and `src/data`, and route definitions in `src/routes` backed by the generated `routeTree.gen.ts`. Hooks and shared state management belong in `src/hooks`, while workers sit inside `src/workers` for isolated browser tasks. Keep tests co-located as `*.test.ts[x]`, static assets in `public/`, global styles in `styles/`, and automation scripts inside `scripts/`. Built bundles land in `dist/`; treat it as ephemeral output.

## Build, Test, and Development Commands

- `bun install`: install dependencies (CI uses `bun install --frozen-lockfile`).
- `bun dev`: start the local dev server with HMR and route regeneration.
- `bunx tsc --noEmit`: run the strict TypeScript check without writing output.
- `bun test`: execute the full Vitest-powered suite; target individual files with `bun test src/lib/csvParser.test.ts` or narrow cases via `-t`.
- `bunx eslint . --ext .ts,.tsx` and `bunx prettier --check .`: enforce linting and formatting; add `--write` locally when you mean to fix violations.
- `bun run ci`: pipeline entry point combining type-check, tests, lint, format check, and TanStack Router generation.

## Coding Style & Naming Conventions

Write modern ESM TypeScript, importing types via `import type` and preferring the `@/` alias for internal modules. Rely on Prettier defaults for formatting and do not disable lint rules inline unless you document the rationale. Components and hooks use PascalCase, functions and variables camelCase, and constants upper snake case. Maintain pure React components, keep `src/components/ui/*` stateless, and wrap stable callbacks with `useCallback` when downstream refs depend on them.

## Testing Guidelines

Vitest drives the suite; co-locate tests beside the code under test and mirror filenames (e.g., `src/lib/csvParser.test.ts`). Aim for meaningful coverage on parsing, filtering, and DuckDB integrations—focus on edge cases around streaming data. Run `bun test` before every commit and rely on `bun run ci` prior to PRs for a full signal. Use descriptive `describe` blocks and prefer integration-style tests when verifying router flows.

## Commit & Pull Request Guidelines

Commits follow Conventional Commits (`feat:`, `fix:`, `chore:` etc.) and should remain focused so reverts stay surgical. Before opening a PR, ensure TypeScript, lint, format, and tests are green; attach relevant screenshots or recordings for UI shifts and reference issues in the description. Document behavioral or schema changes, call out follow-up work, and request review only when automation passes.

## Security & Configuration Tips

Never commit secrets; only variables prefixed with `BUN_PUBLIC_` are safe for the client bundle, so keep service credentials server-side. Regenerate TanStack Router files with `bun run ci` or `bun run build` when routes change, and avoid editing generated artifacts by hand. Audit third-party API integrations under `src/lib` for rate limits and cancellation handling—treat `AbortError` as an expected cancellation path and log ignored failures with `console.warn`.
