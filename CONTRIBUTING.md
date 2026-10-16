# Contributing

## Setup

```bash
corepack enable            # pnpm 10 (see packageManager in package.json)
pnpm install
pnpm build
```

## Before you push

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm build && pnpm test:e2e      # when you touch the console, API or execution flow
```

CI runs all of these, plus the PostgreSQL integration suite, the MCP Inspector smoke test, a container build, secret scanning and a dependency audit.

## Conventions

- **TypeScript only**, ESM, strict mode. Workspace packages export their `src/index.ts` directly; apps are bundled with esbuild (`scripts/bundle.mjs`).
- **Validation at boundaries** with Zod. Domain errors are `AppError` with a code from `packages/shared/src/errors.ts`; messages must be safe to show to users.
- **One service layer.** New behaviour goes into `AgiloftControl` (`packages/core/src/control.ts`) with an authorisation check and an audit record. MCP tools and API routes stay thin.
- **No invented Agiloft behaviour.**
  - A new Agiloft call needs a capability entry in `packages/capabilities/src/registry.ts`, with the official documentation URL, the date checked and the finding.
  - Then regenerate the matrix: `pnpm docs:capabilities`.
  - Undocumented endpoints, database access and browser automation are not accepted.
- **Writes only through plans.** Never add a tool or route that writes to Agiloft outside the approval and execution path.
- **Migrations** are append-only (`packages/core/src/db/migrations.ts`).
- **Tests.**
  - Every safety property needs a test.
  - Contract tests must reflect documented shapes.
  - Never present demo or fake tests as live validation.
- **UI:** accessible primitives, visible labels, status shown by text and icon (not colour alone), and loading, empty, error, permission and disconnected states. Check with the axe assertions in `e2e/`.
- **Secrets:** never in code, fixtures, logs or screenshots. gitleaks runs in CI.

## Commits and pull requests

Small, logically grouped commits with imperative subjects. Describe user-visible behaviour, safety implications and how you tested in the PR.
