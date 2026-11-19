import test from "node:test";
import assert from "node:assert/strict";
import { buildDeviceSearch, mapDevice } from "./devices";
import { packageForBarcode, sizeFromDescription } from "./ndc-sizes";
import { alertText, recallBarcodes } from "./recalls";
import { CATEGORY_QUERIES } from "./openfda";

test("device registry records map with GS1 barcodes, and skip what Liv shouldn't show", () => {
  const record = {
    public_device_record_key: "rec-1", brand_name: "Theragun Prime", company_name: "Therabody, Inc.", version_or_model_number: "G4-PRIME",
    commercial_distribution_status: "In Commercial Distribution", is_otc: "true",
    identifiers: [{ id: "10851939002064", type: "Package", issuing_agency: "GS1" }, { id: "00851939002067", type: "Primary", issuing_agency: "GS1" }],
    product_codes: [{ code: "ISA", name: "Massager, Therapeutic, Electric", openfda: { device_class: "1" } }],
    gmdn_terms: [{ code: "1", name: "Licensed term" }],
  };
  const result = mapDevice(record as never, "Wellness Devices", "2026-11-19");
  assert.ok("product" in result);
  assert.equal(result.product.id, "0851939002067", "primary GS1 identifier, 14 digits stored as 13");
  assert.equal(result.product.name, "Theragun Prime (G4-PRIME)");
  assert.equal(result.product.sourceStatus, "government_registry");
  assert.match(result.product.sources?.[0]?.note ?? "", /not FDA approval/);
  assert.ok(!("gmdn_terms" in result.sourceRow.payload), "licensed GMDN terms are never stored");
  assert.deepEqual(mapDevice({ ...record, commercial_distribution_status: "Not in Commercial Distribution" } as never, "x", "x"), { reason: "no_longer_sold" });
  assert.deepEqual(mapDevice({ ...record, product_codes: [{ name: "Light based over-the-counter hair removal" }] } as never, "x", "x", /hair removal/i), { reason: "not_in_collection" });
  const noGs1 = mapDevice({ ...record, identifiers: [{ id: "+H123ABC", issuing_agency: "HIBCC" }] } as never, "x", "x");
  assert.ok("product" in noGs1 && noGs1.product.id === "udi-rec-1" && noGs1.product.matchConfidence === "probable");
  assert.equal(buildDeviceSearch("massager", true), "product_codes.name%3A%22massager%22+AND+is_otc%3Atrue");
});

test("package sizes come only from an exact or single-package match", () => {
  assert.equal(sizeFromDescription("1 TUBE in 1 CARTON (0363-0123-45) > 50 mL in 1 TUBE"), "50 mL");
  assert.equal(sizeFromDescription("170 g in 1 TUBE (0363-0124-01)"), "170 g");
  assert.equal(sizeFromDescription("1 KIT in 1 BOX"), null);
  const packages = [{ package_ndc: "0363-0123-45", description: "50 mL in 1 TUBE" }, { package_ndc: "0363-0123-99", description: "100 mL in 1 TUBE" }];
  assert.equal(packageForBarcode("0303630123459", packages)?.description, "50 mL in 1 TUBE", "barcode embeds the package code");
  assert.equal(packageForBarcode("0851939002067", packages), null, "two sizes and no embedded match: no guess");
  assert.equal(packageForBarcode("0851939002067", [packages[0]!])?.description, "50 mL in 1 TUBE", "single package");
});

test("recall notices match on barcodes only, and say recalls may be lot-specific", () => {
  const record = { recall_number: "D-0001-2026", code_info: "Lot 123, UPC 0 85193 90020 6 7, exp 2027; UPC 1234", openfda: { upc: ["0036000291452"] }, reason_for_recall: "Microbial contamination", classification: "Class II", report_date: "20260312", recalling_firm: "Sun Co" };
  assert.deepEqual(recallBarcodes(record).sort(), ["0036000291452", "0851939002067"].sort());
  const text = alertText(record);
  assert.equal(text.title, "FDA recall (Class II), reported 2026-03-12");
  assert.match(text.detail, /only certain lots/);
});

test("new label types keep lip balms and hand creams but not diaper or hemorrhoid creams", () => {
  const protectant = CATEGORY_QUERIES.find((query) => query.key === "skin-protectants")!;
  const keep = (name: string) => (!protectant.nameFilter || protectant.nameFilter.test(name)) && !protectant.excludeName?.test(name);
  assert.equal(keep("Ultra Repair Lip Balm"), true);
  assert.equal(keep("Intensive Hand Cream"), true);
  assert.equal(keep("Baby Diaper Rash Cream"), false);
  assert.equal(keep("Hemorrhoid Relief Cream"), false);
});
