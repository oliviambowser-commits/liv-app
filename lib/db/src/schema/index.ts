import { integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

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

export type LivProduct = typeof livProducts.$inferSelect;