# Rules for Bible Search webapp

- DB/Qdrant: Multi-tenancy, single collection 'i'; tenant-id on payload field `s`. For now collection 'bible' used.

## Build / Deploy (Cloudflare Workers Builds)

- Workflows worker: `workflows/` deploys separately with `npx wrangler deploy -c workflows/wrangler.jsonc` (NOT built by Workers Builds). Deploy it before the main app whenever `workflows/` or `src/lib/deepresearch/core.ts` changes.

## Paystack webhooks

- All Paystack webhooks route through the shared `pswh` worker (one Paystack account for every app). Contract + onboarding: `~/i/pswh/README.md`.
- Stamp `metadata.a: 'ver'` at `transaction/initialize` (done in `src/routes/api/billing/buy-tokens/+server.ts`). `pswh` routes the webhook to this app; the existing webhook handler (`/api/billing/webhook/paystack`) is unchanged.
