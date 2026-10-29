import { openai } from "@workspace/integrations-openai-ai-server";
import type {
  AIProvider,
  IdentifyRequest,
  IdentifyResult,
  PackageIdentification,
  ResearchRequest,
  ResearchResult,
  SourceCitation,
} from "./types";

const nullableString = { type: ["string", "null"] };
const identificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "brand", "productName", "variant", "size", "category", "barcodeDigits", "visibleText", "notes"],
  properties: {
    status: { type: "string", enum: ["probable", "unverified", "unreadable"] },
    brand: nullableString,
    productName: nullableString,
    variant: nullableString,
    size: nullableString,
    category: nullableString,
    barcodeDigits: nullableString,
    visibleText: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

const unreadable: PackageIdentification = {
  status: "unreadable",
  brand: null,
  productName: null,
  variant: null,
  size: null,
  category: null,
  barcodeDigits: null,
  visibleText: [],
  notes: "Liv couldn't read this package. Try a closer, well-lit photo of the front label.",
};

function cleanText(value: unknown, max = 120): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function sanitizeIdentification(raw: unknown): PackageIdentification {
  if (!raw || typeof raw !== "object") return unreadable;
  const value = raw as Record<string, unknown>;
  const status = value.status === "probable" || value.status === "unverified" ? value.status : "unreadable";
  const barcode = typeof value.barcodeDigits === "string" ? value.barcodeDigits.replace(/\D/g, "") : "";
  return {
    status,
    brand: cleanText(value.brand),
    productName: cleanText(value.productName),
    variant: cleanText(value.variant),
    size: cleanText(value.size, 40),
    category: cleanText(value.category, 60),
    barcodeDigits: [8, 12, 13, 14].includes(barcode.length) ? barcode : null,
    visibleText: Array.isArray(value.visibleText)
      ? value.visibleText.filter((item): item is string => typeof item === "string").slice(0, 12).map((item) => item.slice(0, 120))
      : [],
    notes: cleanText(value.notes, 400) ?? "",
  };
}

type RawOutputItem = {
  type?: string;
  content?: Array<{
    type?: string;
    annotations?: Array<Record<string, unknown>>;
  }>;
};

export class OpenAIResponsesProvider implements AIProvider {
  readonly name = "openai";

  async research(request: ResearchRequest): Promise<ResearchResult> {
    const response = await openai.responses.create({
      model: request.model,
      instructions:
        "You are Liv, a careful consumer product research assistant. Use catalog facts and only web sources from the approved domains provided in this request. Distinguish verified facts from community-submitted or uncertain data. Never invent a product match, ingredient, score, review, price, or citation. If exact variant or evidence is missing or sources conflict, say so and ask a clarifying question when useful. Do not diagnose, prescribe, or claim a product is universally safe. Ingredient-level research does not prove a finished product works. Explain which source supports each product-specific statement and what remains unknown. Never invent URLs; the app displays source links separately.",
      input: request.prompt,
      tools: request.useWebSearch
        ? [{ type: "web_search", filters: { allowed_domains: request.approvedDomains } }]
        : [],
      max_output_tokens: 900,
    });

    const citations: SourceCitation[] = [];
    const output = (response.output ?? []) as unknown as RawOutputItem[];
    let webSearchCalls = 0;
    for (const item of output) {
      if (item.type === "web_search_call") webSearchCalls += 1;
      for (const content of item.content ?? []) {
        for (const annotation of content.annotations ?? []) {
          if (annotation.type === "url_citation" && typeof annotation.url === "string") {
            citations.push({
              title: typeof annotation.title === "string" ? annotation.title : annotation.url,
              url: annotation.url,
            });
          }
        }
      }
    }

    const usage = response.usage;
    return {
      text: response.output_text || "I couldn’t verify enough information to answer that yet.",
      citations: [...new Map(citations.map((item) => [item.url, item])).values()],
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      webSearchCalls,
    };
  }

  async identifyFromImage(request: IdentifyRequest): Promise<IdentifyResult> {
    const response = await openai.responses.create({
      model: request.model,
      instructions:
        "You read consumer product packaging for Liv. Report only what is visible in the photo. Never guess a brand, product name, variant, size, or barcode you cannot read; use null instead. Use status \"probable\" only when the brand and product name are both clearly legible. Use \"unverified\" when you can read part of the package but key details are unclear. Use \"unreadable\" when the image does not show a readable product package. Do not describe ingredients, safety, effectiveness, or claims; Liv looks those up separately from sources. In notes, briefly say what was unclear and what photo would help.",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Identify the product in this photo from its visible packaging." },
            { type: "input_image", image_url: `data:${request.mediaType};base64,${request.imageBase64}`, detail: "auto" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "package_identification",
          strict: true,
          schema: identificationSchema,
        },
      },
      max_output_tokens: 600,
    });

    let identification = unreadable;
    try {
      identification = sanitizeIdentification(JSON.parse(response.output_text || "null"));
    } catch {
      identification = unreadable;
    }
    return {
      identification,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
}
