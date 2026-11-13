import { boolean, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export type LivSource = {
  label: string;
  url: string;
  sourceType: "community_database" | "manufacturer" | "regulatory_label" | "government_certification" | "scientific_literature" | "web_research";
  license?: string;
  retrievedAt: string;
  sourceUpdatedAt?: string;
  note: string;
};

export type LivEvidence = {
  ingredient: string;
  title: string;
  url: string;
  sourceType: "scientific_literature";
  retrievedAt: string;
  studyDesign: string;
  confidence: string;
  coverage: string;
  summary: string;
  limitation: string;
};

export type LivProductScore = {
  dimension: string;
  value: number | null;
  status: "available" | "insufficient_evidence";
  method: string;
  rationale: string;
  coverage: string;
  confidence: string;
  reviewedAt: string;
  evidenceSourceUrls: string[];
};

/** One researched fact shown on a product page, always tied to its source. */
export type LivDetail = { label: string; value: string; sourceUrl: string };

export type DiscoveryCandidate = {
  brand: string;
  name: string;
  variant: string | null;
  size: string | null;
  category: string;
  productUrl: string;
  isOfficialSite: boolean;
};

export const livProducts = pgTable("liv_products", {
  id: text("id").primaryKey(),
  brand: text("brand").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  quantity: text("quantity"),
  ingredientsText: text("ingredients_text"),
  sourceStatus: text("source_status").notNull().default("unverified"),
  sources: jsonb("sources").$type<LivSource[]>().notNull().default([]),
  ingredientEvidence: jsonb("ingredient_evidence").$type<LivEvidence[]>().notNull().default([]),
  scores: jsonb("scores").$type<LivProductScore[]>().notNull().default([]),
  communityRating: real("community_rating"),
  communityReviewCount: integer("community_review_count"),
  communityRatingSource: text("community_rating_source"),
  imageUrl: text("image_url"),
  imageAttribution: text("image_attribution"),
  // confirmed: exact identity verified (barcode); probable: read from the brand's
  // own product page; unverified: assembled from other web sources.
  matchConfidence: text("match_confidence"),
  productUrl: text("product_url"),
  summary: text("summary"),
  details: jsonb("details").$type<LivDetail[]>().notNull().default([]),
  // Which source owns this row's display data (open_beauty, openfda, epa_safer_choice, ...).
  // Imports only ever update rows they own, so sources are never blended together.
  primarySource: text("primary_source"),
  // confirmed (tagged as sold in the US), likely (US barcode or US retailer), possible, or null.
  usRelevance: text("us_relevance"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Each source's record of a product, exactly as received and never edited.
// Keeps open-license data (ODbL) separate from Liv's own data and records
// what every source says, even when another source owns the product row.
export const sourceRecords = pgTable("source_records", {
  source: text("source").notNull(),
  sourceKey: text("source_key").notNull(),
  productId: text("product_id"),
  license: text("license").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  fingerprint: text("fingerprint").notNull(),
  // active, or not_listed when a refresh no longer finds it (never deleted)
  status: text("status").notNull().default("active"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.source, table.sourceKey] })]);

// One row per import run, for progress tracking, refresh scheduling, and rollback.
export const ingestionRuns = pgTable("ingestion_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  status: text("status").notNull().default("running"),
  dryRun: boolean("dry_run").notNull().default(false),
  read: integer("read").notNull().default(0),
  added: integer("added").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  unchanged: integer("unchanged").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  notListed: integer("not_listed").notNull().default(0),
  rejectReasons: jsonb("reject_reasons").$type<Record<string, number>>().notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const aiUsageEvents = pgTable("ai_usage_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  route: text("route").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  webSearchCalls: integer("web_search_calls").notNull().default(0),
  latencyMs: integer("latency_ms").notNull(),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  catalogCacheHit: boolean("catalog_cache_hit").notNull().default(false),
  success: boolean("success").notNull(),
  errorCategory: text("error_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Products found by Liv's web research, held briefly so the user can pick one.
export const discoveryCandidates = pgTable("discovery_candidates", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  candidate: jsonb("candidate").$type<DiscoveryCandidate>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Demand queue: things people searched for that Liv should research overnight.
export const catalogRequests = pgTable("catalog_requests", {
  query: text("query").primaryKey(),
  displayQuery: text("display_query").notNull(),
  votes: integer("votes").notNull().default(0),
  // pending, built, or not_found (retried after a week)
  status: text("status").notNull().default("pending"),
  firstRequestedAt: timestamp("first_requested_at", { withTimezone: true }).notNull().defaultNow(),
  lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
});

// One vote per person per request, so one person can't push their own query up the queue.
export const catalogRequestVotes = pgTable("catalog_request_votes", {
  query: text("query").notNull(),
  clientId: text("client_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.query, table.clientId] })]);

// Daily per-person counts of paid research actions (anonymous app install ID).
export const clientDailyUsage = pgTable("client_daily_usage", {
  clientId: text("client_id").notNull(),
  day: text("day").notNull(),
  kind: text("kind").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.clientId, table.day, table.kind] })]);

export type LivProduct = typeof livProducts.$inferSelect;
