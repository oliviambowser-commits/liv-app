import test from "node:test";
import assert from "node:assert/strict";
import { OPEN_SOURCES, frontImage, imageFolder } from "../open-data";
import { pickLabelImage, setIdFromUrl } from "./dailymed-images";

test("finds the front photo in both Open Facts image formats", () => {
  const src = OPEN_SOURCES.beauty;
  assert.equal(frontImage({ images: { selected: { front: { fr: { rev: 4 }, en: { rev: 9 } } } } }, src, "3606000537422"),
    "https://images.openbeautyfacts.org/images/products/360/600/053/7422/front_en.9.400.jpg", "newer format, English first");
  assert.equal(frontImage({ images: { selected: { front: { de: { rev: 2 } } } } }, src, "3606000537422")?.endsWith("front_de.2.400.jpg"), true, "any language when no English");
  assert.equal(frontImage({ images: { front_fr: { rev: "5" } } }, src, "3606000537422")?.endsWith("front_fr.5.400.jpg"), true, "older format");
  assert.equal(frontImage({ image_front_url: "https://images.openbeautyfacts.org/x.jpg", images: { front_en: { rev: 1 } } }, src, "1"), "https://images.openbeautyfacts.org/x.jpg", "ready-made URL wins");
  assert.equal(frontImage({ image_front_url: "http://insecure/x.jpg" }, src, "3606000537422"), null, "only https");
  assert.equal(frontImage({ images: { ingredients_en: { rev: 1 } } }, src, "3606000537422"), null, "no front photo, no image");
  assert.equal(imageFolder("012345678905"), "001/234/567/8905", "12-digit codes are padded to 13");
});

test("picks the package image from DailyMed and skips chemical structures", () => {
  assert.equal(pickLabelImage([
    { name: "structure-01.jpg", mime_type: "image/jpeg", url: "https://dailymed.nlm.nih.gov/a.jpg" },
    { name: "sunscreen-01.jpg", mime_type: "image/jpeg", url: "https://dailymed.nlm.nih.gov/b.jpg" },
    { name: "Carton-PDP.jpg", mime_type: "image/jpeg", url: "https://dailymed.nlm.nih.gov/c.jpg" },
  ]), "https://dailymed.nlm.nih.gov/c.jpg");
  assert.equal(pickLabelImage([{ name: "label.jpg", mime_type: "image/jpeg", url: "https://dailymed.nlm.nih.gov/d.jpg" }]), "https://dailymed.nlm.nih.gov/d.jpg");
  assert.equal(pickLabelImage([{ name: "doc.pdf", mime_type: "application/pdf", url: "https://x/doc.pdf" }]), null);
  assert.equal(setIdFromUrl("https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=1EFE378E-fee1-4ae9-8ea5-0fe2265fe2d8"), "1efe378e-fee1-4ae9-8ea5-0fe2265fe2d8");
  assert.equal(setIdFromUrl(null), null);
});
