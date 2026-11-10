import test from "node:test";
import assert from "node:assert/strict";
import { assessCompleteness } from "./completeness";
import { brandTag } from "../scripts/audit-open-beauty-facts";

const now = new Date("2026-11-09T00:00:00Z");

test("rates completeness from the fields a product page and ingredient analysis need", () => {
  const full = assessCompleteness({ code: "3606000537422", name: "Moisturizing Cream", brand: "CeraVe", category: "en:face-creams", ingredients: "Aqua, Glycerin, Cetearyl Alcohol", imageUrl: "https://x/i.jpg", quantity: "453 g", lastModified: new Date("2024-11-09T00:00:00Z") }, now);
  assert.equal(full.level, "complete");
  assert.deepEqual(full.missing, []);
  assert.equal(full.ageYears, 2);

  const noIngredients = assessCompleteness({ code: "3606000537422", name: "Cream", brand: "CeraVe", ingredients: "", imageUrl: null }, now);
  assert.equal(noIngredients.level, "partial");
  assert.deepEqual(noIngredients.missing, ["ingredients", "image", "category", "size"]);

  const badBarcode = assessCompleteness({ code: "3606000537423", name: "Cream", brand: "CeraVe", ingredients: "Aqua, Glycerin, More", imageUrl: "https://x" }, now);
  assert.equal(badBarcode.level, "minimal");
  assert.equal(badBarcode.validBarcode, false);
  assert.equal(assessCompleteness({ code: "3606000537422", name: "Cream", brand: "Brand not listed" }, now).level, "minimal");
});

test("turns brand names into Open Beauty Facts brand tags", () => {
  assert.equal(brandTag("La Roche-Posay"), "la-roche-posay");
  assert.equal(brandTag("Nécessaire"), "necessaire");
  assert.equal(brandTag("The Ordinary"), "the-ordinary");
  assert.equal(brandTag("Dr. Jart+"), "dr-jart");
});
