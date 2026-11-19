/**
 * End-to-end import safety tests against a real Postgres database.
 * Runs only when LIV_TEST_DATABASE_URL points at a disposable database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const url = process.env["LIV_TEST_DATABASE_URL"];
const skip = !url;
if (url) process.env["DATABASE_URL"] = url;

const write = (file: string, records: object[]) => writeFileSync(file, gzipSync(records.map((record) => JSON.stringify(record)).join("\n")));

test("imports never overwrite another source's product, skip unchanged data, and never delete", { skip }, async () => {
  const { db, livProducts, sourceRecords, ingestionRuns, pool } = await import("@workspace/db");
  const { eq, sql } = await import("drizzle-orm");
  const { importOpenFacts } = await import("./open-facts");
  const { importOpenFda } = await import("./openfda");
  const { importSaferChoice, importEnergyStar } = await import("./government");
  const { markNotListed, startRun, finishRun } = await import("../ingest");
  const { noScores } = await import("../seed");
  const log = () => {};
  try {
    await db.execute(sql`truncate liv_products, source_records, ingestion_runs, product_alerts`);
    const base = { category: "Skincare", sources: [], ingredientEvidence: [], scores: noScores, details: [] };
    await db.insert(livProducts).values([
      { ...base, id: "0851939002067", brand: "Old", name: "Old OBF name", sourceStatus: "community_submitted_unverified" },
      { ...base, id: "3606000537422", brand: "Brand Co", name: "Read from brand site", sourceStatus: "brand_website", primarySource: "brand_site" },
      // An older Open Beauty Facts row that Liv later enriched from the brand's page.
      { ...base, id: "0073610000029", brand: "Enriched", name: "Enriched record", sourceStatus: "community_submitted_unverified",
        sources: [{ label: "brand page", url: "https://brand.example/p", sourceType: "manufacturer", retrievedAt: "2026-11-01", note: "" }],
        details: [{ label: "Scent", value: "Fig", sourceUrl: "https://brand.example/p" }] },
    ]);

    // Open Beauty Facts: adopts its own legacy row, leaves the brand-site row alone.
    const file = "/tmp/obf-test.jsonl.gz";
    write(file, [
      { code: "0851939002067", product_name: "Ultra Repair Cream", brands: "First Aid Beauty", countries_tags: ["en:united-states"] },
      { code: "3606000537422", product_name: "OBF version", brands: "CeraVe", countries_tags: ["en:united-states"] },
      { code: "012345678905", product_name: "Daily Body Wash", brands: "Dove" },
      { code: "3337875597197", product_name: "Gel douche", countries_tags: ["en:france"] },
      { code: "0073610000029", product_name: "OBF would overwrite this", countries_tags: ["en:united-states"] },
    ]);
    process.env["CATALOG_FILE_BEAUTY"] = file;
    const first = await importOpenFacts("beauty", false, log);
    assert.equal(first.added, 1, "the new body wash");
    assert.equal(first.updated, 1, "its own legacy row");
    assert.equal(first.unchanged, 2, "brand-site row and the enriched row are not its to change");
    const [enriched] = await db.select().from(livProducts).where(eq(livProducts.id, "0073610000029"));
    assert.equal(enriched?.name, "Enriched record", "enriched row untouched");
    assert.equal(enriched?.details.length, 1);
    const [legacy] = await db.select().from(livProducts).where(eq(livProducts.id, "0851939002067"));
    assert.equal(legacy?.name, "Ultra Repair Cream");
    assert.equal(legacy?.primarySource, "open_beauty");
    const [brandRow] = await db.select().from(livProducts).where(eq(livProducts.id, "3606000537422"));
    assert.equal(brandRow?.name, "Read from brand site", "never overwritten");
    assert.equal(brandRow?.primarySource, "brand_site");
    const [likely] = await db.select().from(livProducts).where(eq(livProducts.id, "0012345678905"));
    assert.equal(likely?.usRelevance, "likely");
    // But its own record of that product is still kept, unedited.
    const obfRecords = await db.select().from(sourceRecords).where(eq(sourceRecords.source, "open_beauty"));
    assert.equal(obfRecords.length, 4);

    // Same file again: nothing changed, nothing rewritten.
    const second = await importOpenFacts("beauty", false, log);
    assert.equal(second.added + second.updated, 0);

    // Product drops out of the export: marked not listed, never deleted.
    write(file, [
      { code: "0851939002067", product_name: "Ultra Repair Cream", brands: "First Aid Beauty", countries_tags: ["en:united-states"] },
      { code: "3606000537422", product_name: "OBF version", brands: "CeraVe", countries_tags: ["en:united-states"] },
    ]);
    const run = await startRun("open_beauty", false);
    const third = await importOpenFacts("beauty", false, log);
    third.notListed = await markNotListed("open_beauty", run.startedAt, false);
    await finishRun(run.id, third, "succeeded");
    assert.equal(third.notListed, 2, "the body wash and the enriched-row test product both dropped out");
    const [stillThere] = await db.select().from(livProducts).where(eq(livProducts.id, "0012345678905"));
    assert.ok(stillThere, "not deleted");
    const [runRow] = await db.select().from(ingestionRuns).where(eq(ingestionRuns.id, run.id));
    assert.equal(runRow?.status, "succeeded");

    // openFDA label for a barcode Open Beauty Facts owns: recorded, not overwritten.
    const fda = await importOpenFda(false, log, async (requestUrl) => {
      if (!requestUrl.includes("purpose%3A%22sunscreen%22")) return { total: 0, results: [] };
      if (requestUrl.includes("limit=1&") || requestUrl.endsWith("limit=1")) return { total: 2, results: [] };
      return { total: 2, results: [
        { set_id: "set-owned", openfda: { brand_name: ["ULTRA REPAIR SPF 30"], manufacturer_name: ["FAB"], upc: ["0851939002067"] }, purpose: ["Sunscreen"] },
        { set_id: "0b1c2d3e-0000-4000-8000-000000000001", openfda: { brand_name: ["MINERAL SUNSCREEN SPF 50"], manufacturer_name: ["SUN CO"], upc: ["0036000291452"] }, purpose: ["Sunscreen"] },
      ] };
    });
    assert.equal(fda.added, 1);
    assert.equal(fda.unchanged, 1);
    const [owned] = await db.select().from(livProducts).where(eq(livProducts.id, "0851939002067"));
    assert.equal(owned?.primarySource, "open_beauty", "FDA did not take over the OBF row");
    const [fdaRecord] = await db.select().from(sourceRecords).where(eq(sourceRecords.sourceKey, "set-owned"));
    assert.equal(fdaRecord?.productId, "0851939002067", "but the FDA label is linked to it as evidence");

    // Government lists.
    const epa = await importSaferChoice(false, log, [{ "PRODUCT NAME": "Free & Clear Laundry", "COMPANY NAME": "Seventh Generation", UPC: "0732913440016", "FRAGRANCE-FREE": "Y" }]);
    assert.equal(epa.added, 1);
    const air = await importEnergyStar(false, log, [{ brand_name: "Coway", model_number: "AP-1512HH", smoke_cadr_cfm: "233" }]);
    assert.equal(air.added, 1);

    // DailyMed adds an image to the FDA product, and a later FDA refresh keeps it.
    const { addDailyMedImages } = await import("./dailymed-images");
    const setNew = "0b1c2d3e-0000-4000-8000-000000000001";
    await db.update(livProducts).set({ productUrl: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setNew}` }).where(eq(livProducts.id, "0036000291452"));
    let calls = 0;
    const images = await addDailyMedImages(false, log, async () => { calls += 1; return [{ name: "carton-pdp.jpg", mime_type: "image/jpeg", url: "https://dailymed.nlm.nih.gov/img.jpg" }]; });
    assert.equal(images.updated, 1);
    const [withImage] = await db.select().from(livProducts).where(eq(livProducts.id, "0036000291452"));
    assert.equal(withImage?.imageUrl, "https://dailymed.nlm.nih.gov/img.jpg");
    assert.match(withImage?.imageAttribution ?? "", /DailyMed/);
    await db.update(sourceRecords).set({ fingerprint: "force-change" }).where(eq(sourceRecords.sourceKey, "0b1c2d3e-0000-4000-8000-000000000001"));
    await importOpenFda(false, log, async (requestUrl) => {
      if (!requestUrl.includes("purpose%3A%22sunscreen%22")) return { total: 0, results: [] };
      if (requestUrl.includes("limit=1&") || requestUrl.endsWith("limit=1")) return { total: 1, results: [] };
      return { total: 1, results: [{ set_id: "0b1c2d3e-0000-4000-8000-000000000001", openfda: { brand_name: ["MINERAL SUNSCREEN SPF 50"], manufacturer_name: ["SUN CO"], upc: ["0036000291452"] }, purpose: ["Sunscreen"] }] };
    });
    const [afterRefresh] = await db.select().from(livProducts).where(eq(livProducts.id, "0036000291452"));
    assert.equal(afterRefresh?.imageUrl, "https://dailymed.nlm.nih.gov/img.jpg", "refresh kept the image");
    const again = await addDailyMedImages(false, log, async () => { calls += 1; return []; });
    assert.equal(again.read, 0, "labels already checked aren't asked again");
    assert.equal(calls, 1);

    // Recall notice attaches to the Open Beauty Facts product by barcode, without changing it.
    const { importRecalls } = await import("./recalls");
    const { productAlerts } = await import("@workspace/db");
    const [beforeRecall] = await db.select().from(livProducts).where(eq(livProducts.id, "0851939002067"));
    const recalls = await importRecalls(false, log, async (requestUrl) => {
      if (!requestUrl.includes("2026")) return { total: 0, results: [] };
      if (requestUrl.endsWith("limit=1")) return { total: 2, results: [] };
      return { total: 2, results: [
        { recall_number: "D-0001-2026", status: "Ongoing", classification: "Class II", report_date: "20260312", reason_for_recall: "Contamination", openfda: { upc: ["0851939002067"] } },
        { recall_number: "D-0002-2026", status: "Ongoing", report_date: "20260401", product_description: "Some other product", openfda: { upc: ["0099999999993"] } },
      ] };
    }, new Date("2026-11-19"));
    assert.equal(recalls.added, 1);
    assert.equal(recalls.rejectReasons["not_in_catalog"], 1);
    const alerts = await db.select().from(productAlerts).where(eq(productAlerts.productId, "0851939002067"));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.matchedBy, "barcode");
    const [afterRecall] = await db.select().from(livProducts).where(eq(livProducts.id, "0851939002067"));
    assert.equal(afterRecall?.updatedAt.getTime(), beforeRecall?.updatedAt.getTime(), "product row untouched");

    // Package size is added to the FDA product and survives the next label refresh.
    const { addPackageSizes } = await import("./ndc-sizes");
    const sizes = await addPackageSizes(false, log, async () => [{ package_ndc: "1111-2222-33", description: "1 TUBE in 1 CARTON > 85 g in 1 TUBE" }]);
    assert.equal(sizes.updated, 1);
    await db.update(sourceRecords).set({ fingerprint: "force-change-2" }).where(eq(sourceRecords.sourceKey, "0b1c2d3e-0000-4000-8000-000000000001"));
    await importOpenFda(false, log, async (requestUrl) => {
      if (!requestUrl.includes("purpose%3A%22sunscreen%22")) return { total: 0, results: [] };
      if (requestUrl.includes("limit=1&") || requestUrl.endsWith("limit=1")) return { total: 1, results: [] };
      return { total: 1, results: [{ set_id: "0b1c2d3e-0000-4000-8000-000000000001", openfda: { brand_name: ["MINERAL SUNSCREEN SPF 50"], manufacturer_name: ["SUN CO"], upc: ["0036000291452"] }, purpose: ["Sunscreen"] }] };
    });
    const [sized] = await db.select().from(livProducts).where(eq(livProducts.id, "0036000291452"));
    assert.equal(sized?.quantity, "85 g", "size kept through refresh");

    // Devices import as their own source.
    const { importDevices } = await import("./devices");
    const devices = await importDevices(false, log, async (requestUrl) => {
      if (!requestUrl.includes("massager")) return { total: 0, results: [] };
      if (requestUrl.endsWith("limit=1")) return { total: 1, results: [] };
      return { total: 1, results: [{ public_device_record_key: "rec-1", brand_name: "Percussion Massager", company_name: "Wellness Co", is_otc: "true", identifiers: [{ id: "00850012345677", type: "Primary", issuing_agency: "GS1" }], product_codes: [{ name: "Massager, Therapeutic, Electric" }] }] };
    });
    assert.equal(devices.added, 1);

    // Dry run writes nothing.
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(livProducts);
    write(file, [{ code: "0036000291469", product_name: "Brand New Cream", brands: "X", countries_tags: ["en:united-states"] }]);
    const dry = await importOpenFacts("beauty", true, log);
    assert.equal(dry.added, 1, "counts what would be added");
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(livProducts);
    assert.equal(after[0]?.n, before[0]?.n, "but adds nothing");
  } finally {
    await pool.end();
  }
});
