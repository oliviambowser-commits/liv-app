/**
 * Read-only deployment checks. Never runs an import or changes a schema.
 * The production worker must explicitly supply Liv's production connection;
 * a separate project's automatically provisioned DATABASE_URL is not enough.
 */
import { getTableColumns } from "drizzle-orm";

class SetupError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const developmentCheck = args.length === 1 && args[0] === "--development-check";
  if (args.length && !developmentCheck) {
    throw new SetupError("Use no arguments for the worker, or --development-check for a read-only local check.");
  }

  if (!developmentCheck) {
    if (process.env["LIV_CATALOG_TARGET"] !== "production") {
      throw new SetupError("Set LIV_CATALOG_TARGET=production only after selecting Liv's production database.");
    }
    const connection = process.env["LIV_CATALOG_DATABASE_URL"];
    if (!connection) {
      throw new SetupError("Add LIV_CATALOG_DATABASE_URL in the worker project's Secrets. Do not use its automatic DATABASE_URL.");
    }
    // Only this short-lived process is affected. No workspace secret is changed.
    process.env["DATABASE_URL"] = connection;
    const overrides = [
      "CATALOG_DRY_RUN", "CATALOG_FORCE", "CATALOG_SOURCES",
      "CATALOG_FILE_BEAUTY", "CATALOG_FILE_PRODUCTS", "CATALOG_FILE_FOOD",
    ].filter((key) => !!process.env[key]?.trim());
    if (overrides.length) {
      throw new SetupError(`Remove one-off import overrides before scheduling: ${overrides.join(", ")}.`);
    }
    if (!process.env["OPENFDA_API_KEY"]?.trim()) {
      throw new SetupError("Add OPENFDA_API_KEY to the worker project's Secrets before scheduling.");
    }
  }

  const { pool, livProducts, sourceRecords, ingestionRuns } = await import("@workspace/db");
  pool.options.connectionTimeoutMillis = 15_000;
  const tables = [livProducts, sourceRecords, ingestionRuns];
  const names = ["liv_products", "source_records", "ingestion_runs"];
  const client = await pool.connect().catch(async () => {
    await pool.end();
    throw new SetupError("Database connection failed. Check the worker's secret and network access; no credentials were logged.");
  });
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const columns = await client.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [names],
    );
    for (const [index, table] of tables.entries()) {
      const name = names[index]!;
      const actual = new Set(columns.rows.filter((row) => row.table_name === name).map((row) => row.column_name));
      const missing = Object.values(getTableColumns(table)).map((column) => column.name).filter((column) => !actual.has(column));
      if (missing.length) {
        throw new SetupError(`Missing expected columns in ${name}: ${missing.join(", ")}. Apply schema changes through the original Liv project's Publish flow, not this worker.`);
      }
    }
    const permissions = await client.query<{ allowed: boolean }>(
      `SELECT bool_and(
        has_table_privilege(current_user, name, 'SELECT')
        AND has_table_privilege(current_user, name, 'INSERT')
        AND has_table_privilege(current_user, name, 'UPDATE')
      ) AS allowed FROM unnest($1::text[]) AS names(name)`,
      [names.map((name) => `public.${name}`)],
    );
    if (!permissions.rows[0]?.allowed) {
      throw new SetupError("The selected database role needs SELECT, INSERT, and UPDATE on the three catalog tables.");
    }
    const sequence = await client.query<{ allowed: boolean }>(
      `SELECT coalesce(
        has_sequence_privilege(current_user, pg_get_serial_sequence('public.ingestion_runs', 'id'), 'USAGE')
        OR has_sequence_privilege(current_user, pg_get_serial_sequence('public.ingestion_runs', 'id'), 'UPDATE'),
        false
      ) AS allowed`,
    );
    if (!sequence.rows[0]?.allowed) {
      throw new SetupError("The selected database role cannot allocate ingestion-run IDs.");
    }
    console.log(`Catalog preflight passed (${developmentCheck ? "current development database only" : "explicit worker database connection"}): schema and import permissions checked read-only.`);
    console.log("This check does not prove the selected database is production; confirm its connection in Liv's production database Settings.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Database driver messages can include connection details; only emit our
  // own controlled setup errors, never a raw driver message or stack trace.
  const message = error instanceof SetupError
    ? error.message
    : "Database preflight failed. Check connectivity, schema, and role permissions in the worker project.";
  console.error(message);
  process.exitCode = 1;
});
