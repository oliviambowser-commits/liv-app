# Liv Product Advisor

Liv helps thoughtful shoppers compare everyday products using transparent, evidence-aware information and clear uncertainty.

## Run & Operate

- `pnpm --filter @workspace/liv run dev` — run the Expo mobile app.
- `pnpm --filter @workspace/liv run typecheck` — typecheck the mobile app.
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/liv/` — Expo / React Native mobile app.
- `artifacts/liv/app/` — Expo Router screens and navigation.
- `artifacts/liv/constants/colors.ts` — app color tokens.
- `artifacts/liv/assets/images/` — app icon and clearly labeled demo product imagery.

## Architecture decisions

- M0 is a local prototype: persist preferences, saved items, comparison, and demo history on-device; do not add a backend or real catalog integration without a separate product decision.
- Product score dimensions are shown separately; there is no combined Liv Score.
- Community star rating (1–5) is distinct from the 1–100 Community Experience dimension.

## Product

- Ten-screen prototype: onboarding, Home, Ask Liv, Search, Scan, Product Detail, Community, Profile & Memory, Compare, and Saved.
- Product breakdown dimensions include Ingredients & Safety, Effectiveness, Transparency, Community Experience, and Value. M0 values and evidence cards are illustrative demo content, not live research.
- Scoring must disclose evidence gaps and never imply universal safety or a personal health guarantee.

## User preferences

- Use Manrope for headlines and Inter for body text and UI.
- Brand palette: plum, lavender, vanilla latte, sage, warm taupe, charcoal, and a restrained gold aspen-leaf accent. Use sans-serif typography throughout.
- Follow the supplied mockup navigation: Home, Search, Scan, Community, Profile. Ask Liv is a pushed screen; Saved is reached from Profile and product actions.

## Gotchas

- Label sample products, scores, ingredient evidence, and community content as demo; do not present them as sourced internet data or authentic reviews.
- Do not silently select a product when a query is ambiguous, and do not turn an unknown field into a negative score.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
