import type { Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { catalogRequestVotes, catalogRequests, clientDailyUsage, db } from "@workspace/db";
import { logger } from "../lib/logger";

/** Same normalization as discovery, so queue entries line up with cached results. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

/**
 * Who is asking. The app sends an anonymous per-install ID; anything else falls
 * back to the network address. This is a soft limit until Liv has accounts.
 */
export function clientKey(req: Request): string {
  const header = req.get("x-liv-client");
  if (header && /^[A-Za-z0-9-]{8,64}$/.test(header)) return `app:${header}`;
  return `ip:${req.ip ?? "unknown"}`;
}

/** Adds one person's vote for a product or brand Liv should build overnight. */
export async function recordRequest(rawQuery: string, clientId: string) {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2) return;
  try {
    const inserted = await db.insert(catalogRequestVotes).values({ query, clientId }).onConflictDoNothing().returning();
    if (!inserted.length) return; // this person already asked
    await db.insert(catalogRequests)
      .values({ query, displayQuery: rawQuery.trim().slice(0, 120), votes: 1 })
      .onConflictDoUpdate({
        target: catalogRequests.query,
        set: { votes: sql`${catalogRequests.votes} + 1`, lastRequestedAt: new Date() },
      });
  } catch (error) {
    logger.warn({ err: error }, "Could not record catalog request");
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export type UsageKind = "discover" | "build";

/** Counts one paid action; returns false (without counting) if over today's limit. */
export async function takeDailyAllowance(clientId: string, kind: UsageKind, limit: number): Promise<boolean> {
  const [row] = await db.insert(clientDailyUsage)
    .values({ clientId, day: today(), kind, count: 1 })
    .onConflictDoUpdate({
      target: [clientDailyUsage.clientId, clientDailyUsage.day, clientDailyUsage.kind],
      set: { count: sql`${clientDailyUsage.count} + 1` },
    })
    .returning();
  if ((row?.count ?? 1) <= limit) return true;
  await refundDailyAllowance(clientId, kind);
  return false;
}

/** Gives the allowance back when the paid action fails. */
export async function refundDailyAllowance(clientId: string, kind: UsageKind) {
  await db.update(clientDailyUsage)
    .set({ count: sql`greatest(${clientDailyUsage.count} - 1, 0)` })
    .where(and(eq(clientDailyUsage.clientId, clientId), eq(clientDailyUsage.day, today()), eq(clientDailyUsage.kind, kind)))
    .catch((error) => logger.warn({ err: error }, "Could not refund daily allowance"));
}
