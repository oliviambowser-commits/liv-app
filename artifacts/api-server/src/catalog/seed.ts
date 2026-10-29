import type { LivEvidence, LivProductScore, LivSource } from "@workspace/db";

const sourceDate = "2026-10-28";
const openBeautyFactsLicense = "Open Beauty Facts database: ODbL 1.0; individual record: DbCL";

export const noScores: LivProductScore[] = [
  {
    dimension: "Ingredients & Safety",
    value: null,
    status: "insufficient_evidence",
    method: "No universal safety score. Requires a verified exact-variant label and a disclosed product-specific assessment method.",
    rationale: "Community-submitted ingredient data is unverified and does not establish safety or individual tolerance.",
    coverage: "Ingredient text only; formula concentrations and package verification unavailable.",
  },
  {
    dimension: "Effectiveness",
    value: null,
    status: "insufficient_evidence",
    method: "Requires independently sourced evidence about the finished product and a defined outcome.",
    rationale: "Ingredient-level studies do not demonstrate this finished product's effectiveness.",
    coverage: "No product-specific clinical evidence in this pilot.",
  },
  {
    dimension: "Transparency",
    value: null,
    status: "insufficient_evidence",
    method: "Future score uses a fixed checklist of exact variant, complete label, package size, claim substantiation, and current primary sources.",
    rationale: "The available community listing is not independently confirmed against the exact package.",
    coverage: "Primary-source coverage is incomplete.",
  },
  {
    dimension: "Community Experience",
    value: null,
    status: "insufficient_evidence",
    method: "Requires an authentic, lawful review corpus with count and date range.",
    rationale: "No verified review corpus is connected to this pilot.",
    coverage: "No authentic product reviews.",
  },
  {
    dimension: "Value",
    value: null,
    status: "insufficient_evidence",
    method: "Requires current region-specific price and package size from a permitted source.",
    rationale: "No verified comparable price is available.",
    coverage: "Price and unit comparison unavailable.",
  },
];

const ceraveSources: LivSource[] = [
  {
    label: "Open Beauty Facts product record",
    url: "https://world.openbeautyfacts.org/product/3606000537422",
    sourceType: "community_database",
    license: openBeautyFactsLicense,
    retrievedAt: sourceDate,
    sourceUpdatedAt: "2025-04-18",
    note: "Collaborative record; database does not guarantee accuracy. Ingredient transcription requires package verification.",
  },
  {
    label: "CeraVe manufacturer product page",
    url: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream",
    sourceType: "manufacturer",
    retrievedAt: sourceDate,
    note: "Brand product description; not an independent efficacy or safety assessment.",
  },
];

const fabSources: LivSource[] = [
  {
    label: "Open Beauty Facts product record",
    url: "https://world.openbeautyfacts.org/product/0851939002067",
    sourceType: "community_database",
    license: openBeautyFactsLicense,
    retrievedAt: sourceDate,
    sourceUpdatedAt: "2026-10-28",
    note: "Collaborative record; database does not guarantee accuracy. Confirm the current package label.",
  },
  {
    label: "First Aid Beauty product page",
    url: "https://www.firstaidbeauty.com/products/ultra-repair-cream",
    sourceType: "manufacturer",
    retrievedAt: sourceDate,
    note: "Brand product page; product claims are not independent efficacy evidence.",
  },
];

const fabEvidence: LivEvidence[] = [
  {
    ingredient: "Colloidal oatmeal",
    title: "A 1% Colloidal Oatmeal Cream Alone is Effective in Reducing Symptoms of Mild to Moderate Atopic Dermatitis: Results from Two Clinical Studies",
    url: "https://pubmed.ncbi.nlm.nih.gov/28697218/",
    sourceType: "scientific_literature",
    retrievedAt: sourceDate,
    studyDesign: "Two single-center, single-arm clinical studies",
    confidence: "Limited for applying the findings to other formulas",
    coverage: "1% colloidal oatmeal cream in mild-to-moderate atopic dermatitis",
    summary: "The publication reports two single-center, single-arm clinical studies of a 1% colloidal oatmeal cream in people with mild-to-moderate atopic dermatitis.",
    limitation: "Ingredient-level evidence only; it does not test this product or establish results for an individual.",
  },
];

export const seedProducts = [
  {
    id: "3606000537422",
    brand: "CeraVe",
    name: "Moisturizing Cream",
    category: "Skincare",
    quantity: "453 grams",
    ingredientsText: "AQUA/WATER, GLYCERIN, CETEARYL ALCOHOL, CAPRYLIC, CETEARETH-20, PETROLATUM, POTASSIUM PHOSPHATE, CERAMIDE NP, CERAMIDE AP, CERAMIDE EOP, CARBOMER, DIMETHICONE, BEHENTRIMONIUM METHOSULFATE, SODIUM LAUROYL LACTYLATE, SODIUM HYALURONATE, CHOLESTEROL, PHENOXY-ETHANOL, DISODIUM EDTA, DIPOTASSIUM PHOSPHATE, TOCOPHEROL, PHYTOSPHINGOSINE, XANTHAN GUM, ETHYLHEXYLGLYCERIN.",
    sourceStatus: "community_submitted_unverified",
    sources: ceraveSources,
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
  },
  {
    id: "0851939002067",
    brand: "First Aid Beauty",
    name: "Ultra Repair Cream",
    category: "Skincare",
    quantity: null,
    ingredientsText: "AQUA/WATER/EAU, STEARIC ACID, GLYCERIN, C12-15 ALKYL BENZOATE, CAPRYLIC/CAPRIC TRIGLYCERIDE, GLYCERYL STEARATE SE, GLYCERYL STEARATE, CETEARYL ALCOHOL, COLLOIDAL OATMEAL, SQUALANE, CERAMIDE NP, ALLANTOIN, CHRYSANTHEMUM PARTHENIUM (FEVERFEW) EXTRACT, CAMELLIA SINENSIS LEAF EXTRACT, GLYCYRRHIZA GLABRA (LICORICE) ROOT EXTRACT, EUCALYPTUS GLOBULUS (EUCALYPTUS) LEAF OIL, BUTYROSPERMUM PARKII (SHEA) BUTTER, DIMETHICONE, CAPRYLYL GLYCOL, XANTHAN GUM, PHENOXYETHANOL, SODIUM HYDROXIDE, TETRASODIUM EDTA",
    sourceStatus: "community_submitted_unverified",
    sources: fabSources,
    ingredientEvidence: fabEvidence,
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
  },
];
