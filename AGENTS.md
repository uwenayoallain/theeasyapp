# Repository Guidelines

## Project Structure & Module Organization
- `src/` — React app entrypoint (`src/index.tsx` via `Bun.serve`), HTML (`src/index.html`), and components.
- `src/components/ui/*` — Stateless UI primitives. Prefer composition; no side effects.
- `src/lib/utils.ts` — Shared helpers (e.g., `cn()` for class names).
- `styles/` — Global Tailwind styles and design tokens.
- `build.ts` — Bun build pipeline; outputs to `dist/`.
- Tests (when added): co‑locate as `*.test.ts[x]` under `src/`.

## Build, Test, and Development Commands
- Install deps: `bun install`
- Dev server (HMR): `bun dev`
- Start (production): `bun start`
- Build: `bun run build.ts` (maintainers run release builds; do not auto‑run in PRs)
- Test: `bun test` | file: `bun test path/to/file.test.ts` | name: `bun test -t "exact|/regex/"` | watch: `bun test --watch`
- Type check: `bunx tsc --noEmit`
- Format: `bunx prettier --write .` (check: `bunx prettier --check .`)

## Coding Style & Naming Conventions
- ESM imports; use `import type` for types; prefer `@/` alias (see `tsconfig.json`).
- Prettier defaults: 2‑space indent, semicolons, trailing commas.
- Strict types; avoid `any`. Use `unknown` at boundaries and narrow with guards.
- React: pure components; named exports; Components/Hooks in PascalCase; vars/functions camelCase; constants UPPER_SNAKE.
- Use `cn()` for class composition; keep UI primitives stateless.

## Testing Guidelines
- Runner: Bun test. Write `*.test.ts`/`*.test.tsx` next to the code under `src/`.
- Cover edge cases for API routes (`Response.json(...)`) and utilities.
- Aim for meaningful coverage; snapshot test UI where stable.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
- PRs: concise description, linked issues, steps to test, and screenshots for UI changes. Keep PRs small and focused.

## Security & Configuration
- Bun‑first: use `Bun.serve`, `Bun.file`, `bun:sqlite`/`Bun.sql`. Avoid Express/Vite/ws/pg.
- Env: Bun autoloads `.env`. Only expose `BUN_PUBLIC_*` to the client (see `bunfig.toml`).
- Errors: wrap async in try/catch; return `Response.json({ error }, { status })`; avoid string throws.
