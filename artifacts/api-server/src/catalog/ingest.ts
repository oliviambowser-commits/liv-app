import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, ingestionRuns, livProducts, sourceRecords } from "@workspace/db";

/**
 * Shared machinery for every catalog import:
 * - each run is recorded (counts, rejections, errors) for tracking and rollback
 * - every source record is stored exactly as received, with a fingerprint so
 *   unchanged records cost nothing on the next refresh
 * - an import only creates product rows or updates rows it owns, so one
 *   source never overwrites or blends into another source's data
 * - records a refresh no longer finds are marked not_listed, never deleted
 * - dry runs count what would change without writing anything
 */

export type ProductRow = typeof livProducts.$inferInsert & { id: string; primarySource: string };

export type SourceRow = {
  sourceKey: string;
  productId: string | null;
  payload: Record<string, unknown>;
};

export type RunStats = {
  read: number;
  added: number;
  updated: number;
  unchanged: number;
  rejected: number;
  notListed: number;
  rejectReasons: Record<string, number>;
};

export const emptyStats = (): RunStats => ({ read: 0, added: 0, updated: 0, unchanged: 0, rejected: 0, notListed: 0, rejectReasons: {} });

export function reject(stats: RunStats, reason: string) {
  stats.rejected += 1;
  stats.rejectReasons[reason] = (stats.rejectReasons[reason] ?? 0) + 1;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export async function startRun(source: string, dryRun: boolean): Promise<{ id: number; startedAt: Date }> {
  const [run] = await db.insert(ingestionRuns).values({ source, dryRun }).returning({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt });
  return run!;
}

export async function finishRun(id: number, stats: RunStats, status: "succeeded" | "failed" | "partial", error?: string) {
  await db.update(ingestionRuns).set({ ...stats, status, error: error?.slice(0, 2000) ?? null, finishedAt: new Date() }).where(eq(ingestionRuns.id, id));
}

/** When this source last finished a real (not dry) run successfully. */
export async function lastSuccess(source: string): Promise<Date | null> {
  const [run] = await db.select({ finishedAt: ingestionRuns.finishedAt }).from(ingestionRuns)
    .where(and(eq(ingestionRuns.source, source), eq(ingestionRuns.status, "succeeded"), eq(ingestionRuns.dryRun, false)))
    .orderBy(desc(ingestionRuns.finishedAt)).limit(1);
  return run?.finishedAt ?? null;
}

/**
 * Stores source records unedited. Returns how many were new or changed, so
 * product rows are only rewritten when their source actually changed.
 */
export async function saveSourceRecords(source: string, license: string, rows: SourceRow[], dryRun: boolean): Promise<Set<string>> {
  const changed = new Set<string>();
  if (!rows.length) return changed;
  const unique = [...new Map(rows.map((row) => [row.sourceKey, row])).values()];
  const existing = await db.select({ key: sourceRecords.sourceKey, fp: sourceRecords.fingerprint }).from(sourceRecords)
    .where(and(eq(sourceRecords.source, source), inArray(sourceRecords.sourceKey, unique.map((row) => row.sourceKey))));
  const known = new Map(existing.map((row) => [row.key, row.fp]));
  const now = new Date();
  const values = unique.map((row) => {
    const fp = fingerprint(row.payload);
    if (known.get(row.sourceKey) !== fp) changed.add(row.sourceKey);
    return { source, sourceKey: row.sourceKey, productId: row.productId, license, payload: row.payload, fingerprint: fp, status: "active", lastSeenAt: now };
  });
  if (dryRun) return changed;
  await db.insert(sourceRecords).values(values).onConflictDoUpdate({
    target: [sourceRecords.source, sourceRecords.sourceKey],
    set: {
      productId: sql`excluded.product_id`,
      payload: sql`excluded.payload`,
      fingerprint: sql`excluded.fingerprint`,
      license: sql`excluded.license`,
      status: sql`'active'`,
      lastSeenAt: sql`excluded.last_seen_at`,
    },
  });
  return changed;
}

/**
 * Creates product rows that don't exist and updates rows this source owns.
 * Rows owned by another source are left exactly as they are.
 * `legacyStatus` lets a source adopt rows it created before ownership existed.
 */
export async function upsertOwnedProducts(rows: ProductRow[], stats: RunStats, dryRun: boolean, legacyStatus?: string) {
  if (!rows.length) return;
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const source = unique[0]!.primarySource;
  const existing = await db.select({ id: livProducts.id, owner: livProducts.primarySource, status: livProducts.sourceStatus, sources: livProducts.sources, details: livProducts.details }).from(livProducts)
    .where(inArray(livProducts.id, unique.map((row) => row.id)));
  const byId = new Map(existing.map((row) => [row.id, row]));
  const toWrite: ProductRow[] = [];
  for (const row of unique) {
    const current = byId.get(row.id);
    if (!current) { stats.added += 1; toWrite.push(row); continue; }
    // A legacy row is adopted only if it holds nothing but that source's own data.
    // Rows Liv enriched (brand pages, research, evidence) are left untouched.
    const enriched = current.sources.some((item) => item.sourceType !== "community_database") || current.details.length > 0;
    const owns = current.owner === source || (current.owner === null && legacyStatus !== undefined && current.status === legacyStatus && !enriched);
    if (owns) { stats.updated += 1; toWrite.push(row); } else { stats.unchanged += 1; }
  }
  if (dryRun || !toWrite.length) return;
  const ownedBySource = legacyStatus
    ? or(eq(livProducts.primarySource, source), and(isNull(livProducts.primarySource), eq(livProducts.sourceStatus, legacyStatus), sql`${livProducts.details} = '[]'::jsonb`, sql`not exists (select 1 from jsonb_array_elements(${livProducts.sources}) s where s->>'sourceType' <> 'community_database')`))
    : eq(livProducts.primarySource, source);
  await db.insert(livProducts).values(toWrite).onConflictDoUpdate({
    target: livProducts.id,
    set: {
      brand: sql`excluded.brand`,
      name: sql`excluded.name`,
      category: sql`excluded.category`,
      quantity: sql`excluded.quantity`,
      ingredientsText: sql`excluded.ingredients_text`,
      sourceStatus: sql`excluded.source_status`,
      sources: sql`excluded.sources`,
      // A refresh never removes an image the product already has (for example one added from DailyMed).
      imageUrl: sql`coalesce(excluded.image_url, ${livProducts.imageUrl})`,
      imageAttribution: sql`case when excluded.image_url is not null then excluded.image_attribution else ${livProducts.imageAttribution} end`,
      matchConfidence: sql`excluded.match_confidence`,
      productUrl: sql`excluded.product_url`,
      details: sql`excluded.details`,
      primarySource: sql`excluded.primary_source`,
      usRelevance: sql`excluded.us_relevance`,
      updatedAt: sql`now()`,
    },
    // Second guard in the database itself: only rows this source owns change.
    setWhere: ownedBySource,
  });
}

/** Marks records a full refresh no longer found. Nothing is deleted. */
export async function markNotListed(source: string, runStartedAt: Date, dryRun: boolean): Promise<number> {
  const stale = await db.select({ key: sourceRecords.sourceKey }).from(sourceRecords)
    .where(and(eq(sourceRecords.source, source), eq(sourceRecords.status, "active"), lt(sourceRecords.lastSeenAt, runStartedAt)));
  if (!dryRun && stale.length) {
    await db.update(sourceRecords).set({ status: "not_listed" })
      .where(and(eq(sourceRecords.source, source), eq(sourceRecords.status, "active"), lt(sourceRecords.lastSeenAt, runStartedAt)));
  }
  return stale.length;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetch with retries and backoff for temporary failures (rate limits, server errors, network). */
export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export const titleCase = (value: string) =>
  value.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase()).replace(/\bSpf\b/g, "SPF").replace(/\bUv\b/g, "UV");

export const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
