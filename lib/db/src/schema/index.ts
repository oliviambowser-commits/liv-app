import { boolean, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export type LivSource = {
  label: string;
  url: string;
  sourceType: "community_database" | "manufacturer" | "scientific_literature" | "web_research";
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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