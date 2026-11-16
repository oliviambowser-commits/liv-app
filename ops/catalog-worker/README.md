# Liv nightly catalog worker

**Status: setup prepared, not published or scheduled.** The original Liv project remains an Autoscale API. Run this worker in a separate Replit project; do not change the original project's deployment type.

## 1. Create the worker project

Create a separate Replit project named, for example, **Liv Catalog Worker**, using a copy of the current repository that includes this guide and `catalog-preflight.ts`. Do not import an older GitHub revision that lacks these files. This task did not push the setup to GitHub.

Keep the monorepo paths, package manifests, workspace catalog, and lockfile together. The command relies on `@workspace/db` and the API package's TypeScript source, not just the built HTTP server. No new web service, port, or HTTP endpoint is needed.

If Replit recognizes the copied API, mobile, and design artifacts, have the Agent **in the new worker project** prepare a scheduled-only publishing configuration. It must set the copied API production command to the worker run command below and remove its HTTP startup health check. It must exclude the mobile/design services from this worker's publishing configuration. Artifact configuration must be changed using Replit's validated artifact editor, not by pasting a replacement into the original project's configuration.

Suggested instruction for that new project's Agent:

> This is a separate scheduled-only Liv catalog worker. Follow ops/catalog-worker/README.md. Keep the monorepo package paths, configure only the catalog job for publishing, and do not start or publish a web API or Expo service. Use the listed build/run commands, cron 0 2 * * *, and America/Denver timezone. Do not publish, migrate databases, or run a live import during setup.

## 2. Connect the intended database securely

The worker's automatically provisioned database is **not** Liv's production catalog. Do not seed it and assume that updates will reach the app.

In the **original Liv project**, open **Database → Production → Settings** to obtain the production connection details. Configure the following in the **worker project's Secrets** and ensure they are available to its published job:

| Setting | Purpose |
| --- | --- |
| `LIV_CATALOG_DATABASE_URL` (secret) | Liv's production PostgreSQL connection string, not this worker's automatic database connection. |
| `OPENFDA_API_KEY` (secret) | Copy securely through Secrets; do not paste the value into chat, source files, Git, or this guide. |
| `LIV_CATALOG_TARGET=production` (non-secret) | Explicit acknowledgement that the intended database was selected. |

Use the supported connection details from Liv's production database Settings; do not change or manually override the runtime-managed `DATABASE_URL` secret. The run command below selects the dedicated connection only for the import process. Sharing a production connection grants write access to Liv's catalog; treat this worker project and its collaborators accordingly.

In the original project, both the production database secret and FDA key were reported present. The new worker's secret configuration and production schema have **not** been verified: production database queries require an authenticated session. Secret presence alone does not establish that a credential is valid or points to the intended database.

The preflight checks all expected columns on `liv_products`, `source_records`, and `ingestion_runs`, plus the role's import permissions. It performs no DDL or data writes. If production is missing schema, apply it through **Publish in the original Liv project**, not by running database push/migration commands in the worker.

Do not leave `CATALOG_FORCE`, `CATALOG_SOURCES`, `CATALOG_DRY_RUN`, or local `CATALOG_FILE_*` overrides set on the scheduled job. The nightly entry point already decides which sources are due.

## 3. Install and check without importing

Use Node.js 24 and pnpm 10, matching the verified workspace. From the worker project root:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm --filter @workspace/api-server run catalog:preflight
```

Keep development dependencies installed: `catalog:nightly` invokes `tsx`, which is currently a development dependency. A production-only/pruned install will not support this command. The built HTTP server does not contain the standalone nightly entry point.

The preflight fails rather than falling back to the worker's automatic database when the dedicated secret or explicit target acknowledgement is missing. It also blocks leftover one-off source/dry-run overrides. It never prints connection credentials.

For testing the check **only against the current project's development database**, use:

```sh
pnpm --filter @workspace/api-server run catalog:preflight --development-check
```

That flag is not appropriate for publishing and does not verify production.

## 4. Publishing settings — new worker project only

Open **Publishing → Adjust settings** in the worker project. Select **Scheduled** as its deployment type. Do not do this in the original Liv project.

| Field | Value |
| --- | --- |
| Cron expression | `0 2 * * *` |
| Time zone | `America/Denver` (Mountain time), not a fixed MST/UTC offset |
| Build command | `pnpm install --frozen-lockfile --prod=false` |
| Job timeout | Request **4 hours / 240 minutes**, if that value is supported by the Publishing UI. |
| Run command | See below. |

Copy this single-line run command:

```sh
pnpm --filter @workspace/api-server run catalog:preflight && DATABASE_URL="${LIV_CATALOG_DATABASE_URL:?Configure LIV_CATALOG_DATABASE_URL in worker Secrets}" pnpm --filter @workspace/api-server run catalog:nightly
```

This retains the requested `pnpm --filter @workspace/api-server run catalog:nightly` entry point, with read-only setup checks beforehand and an explicitly selected database. It does not change any source's refresh interval.

Allow for weekly Open Food Facts scans plus the other imports and DailyMed requests in the same execution. The observed development scan took about 40 minutes; the previous estimate was 1–3 hours. Production and provider conditions can be slower. Current documentation confirms a configurable timeout but does not publish the allowed maximum. **If the UI cannot accommodate the intended run duration, stop and resolve that limitation before publishing.**

### Mountain time and daylight saving

The intended schedule is 2am in the `America/Denver` time zone, not a constant UTC hour: normally 09:00 UTC during MST and 08:00 UTC during MDT. Setting the process `TZ` variable alone does not configure the deployment scheduler.

At the spring transition, clocks jump from 01:59 to 03:00, so local **02:00 does not exist on that date**. Current Scheduled Deployment documentation does not specify whether a nonexistent scheduled time is skipped or caught up; do not promise a run that day. Check the Publishing next-run display and confirm time-zone behavior around DST transitions. Do not substitute a different hour or a fixed UTC schedule without approval.

## 5. Final checks and activation

1. Confirm you are in the **worker** project; the original Liv API must remain Autoscale.
2. Confirm the dedicated connection is Liv's **production** catalog, and the worker's read-only preflight passes in the published environment.
3. Confirm all required secrets are attached to the job, not just available in a development Shell.
4. Confirm `0 2 * * *`, `America/Denver`, timeout, build command, and run command. Review the displayed next-run time.
5. Review the estimated scheduled compute cost. **You must click Publish yourself.** Until then, no nightly job is active.
6. After the first scheduled execution, inspect `ingestion_runs` for each due source. The existing nightly script catches individual source failures and can still exit zero, so process success alone is not sufficient. Check failure messages and per-source statuses; do not rely solely on deployment-level failure alerts.
7. The job must finish and exit; it must not start the HTTP server or Metro. Avoid concurrent manual imports, and verify a prior run has finished before triggering another.

## Verification of this handoff

- The original production deployment was verified as a healthy public Autoscale deployment.
- `tsx` is installed by the explicit non-pruned build command; workspace dependencies remain linked.
- The new preflight can be exercised read-only in development and refuses an unconfigured production worker.
- No production schema changes, production imports, scheduled deployment, or Publish action were performed in preparing this handoff.

## Official references

- [Deployment types and Scheduled settings](https://docs.replit.com/features/publishing/deployment-types#scheduled)
- [Publishing](https://docs.replit.com/features/publishing/overview)
- [Database connection details](https://docs.replit.com/features/data-and-storage/connection-details)
- [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production)
