# Rules for Bible Search webapp

## Code Style

- Naming: always snake_case for vars/functions; make db payload, type defs, request JSON and page load return value keys always single letters.
- DB/Qdrant: Multi-tenancy, single collection 'i'; tenant-id on payload field `s`. For now collection 'bible' used.
- Conciseness: no vars for single-use; code minimally
- never start the dev server
- fonts go in static/fonts

## Env

- QDRANT_URL, QDRANT_KEY, OPENROUTER_KEY from ~/i/e4/.env

## Build / Deploy (Cloudflare Workers Builds)

- Build command: `pnpm build` → `vite build` (no `wrangler types` in the build script). See global AGENTS.md rule: never put `wrangler types` in a SvelteKit Cloudflare project's `build` script — it breaks builds in CI.
- Workflows worker: `workflows/` deploys separately with `npx wrangler deploy -c workflows/wrangler.jsonc` (NOT built by Workers Builds). Deploy it before the main app whenever `workflows/` or `src/lib/deepresearch/core.ts` changes.

## Paystack webhooks

- All Paystack webhooks route through the shared `pswh` worker (one Paystack account for every app). Contract + onboarding: `~/i/pswh/README.md`.
- Stamp `metadata.a: 'ver'` at `transaction/initialize` (done in `src/routes/api/billing/buy-tokens/+server.ts`). `pswh` routes the webhook to this app; the existing webhook handler (`/api/billing/webhook/paystack`) is unchanged.
