# Notes for AI coding agents

- Read `README.md`, `docs/architecture.md` and `CONTRIBUTING.md` first.
- All behaviour goes through `packages/core/src/control.ts` (`AgiloftControl`). MCP tools (`apps/mcp-server/src/tools.ts`) and API routes (`apps/api/src/routes.ts`) are thin adapters.
- Never add Agiloft calls that are not backed by an entry in `packages/capabilities/src/registry.ts` citing official documentation. Never add endpoints that let an AI client approve plans, delete records, run SQL or fetch arbitrary URLs.
- Run `pnpm lint && pnpm typecheck && pnpm test` before committing. Use `pnpm build && pnpm test:e2e` for console or flow changes.
- Demo/fake tests are not live validation; say so explicitly in summaries.
