import { parseBarcode } from "./gtin";

/**
 * How complete a product record is. Completeness is not accuracy: a complete
 * record can still be out of date or wrong, so this never makes data "verified".
 */
export type CompletenessInput = {
  code?: string | null;
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  ingredients?: string | null;
  imageUrl?: string | null;
  quantity?: string | null;
  lastModified?: Date | null;
};

export type Completeness = {
  level: "complete" | "partial" | "minimal";
  missing: string[];
  validBarcode: boolean;
  ageYears: number | null;
};

/** Fields needed for a useful product page and for ingredient-based analysis. */
const CORE = ["name", "brand", "barcode", "ingredients", "image"] as const;

export function assessCompleteness(input: CompletenessInput, now = new Date()): Completeness {
  const has = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;
  const parsed = input.code ? parseBarcode(input.code) : "invalid_format";
  const validBarcode = typeof parsed !== "string";
  const present: Record<string, boolean> = {
    name: has(input.name),
    brand: has(input.brand) && input.brand !== "Brand not listed",
    barcode: validBarcode,
    ingredients: has(input.ingredients) && (input.ingredients ?? "").trim().length >= 10,
    image: has(input.imageUrl),
    category: has(input.category),
    size: has(input.quantity),
  };
  const missing = Object.entries(present).filter(([, ok]) => !ok).map(([field]) => field);
  const coreMissing = CORE.filter((field) => !present[field]).length;
  const ageYears = input.lastModified ? Math.round(((now.getTime() - input.lastModified.getTime()) / (365.25 * 86_400_000)) * 10) / 10 : null;
  return {
    level: coreMissing === 0 ? "complete" : present.name && present.brand && validBarcode ? "partial" : "minimal",
    missing,
    validBarcode,
    ageYears,
  };
}
