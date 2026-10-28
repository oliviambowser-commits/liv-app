import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export type LivSource = {
  label: string;
  url: string;
  sourceType: "community_database" | "manufacturer" | "scientific_literature";
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

export type LivProduct = typeof livProducts.$inferSelect;