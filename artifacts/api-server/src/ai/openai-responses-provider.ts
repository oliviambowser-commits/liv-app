import { openai } from "@workspace/integrations-openai-ai-server";
import type { AIProvider, ResearchRequest, ResearchResult, SourceCitation } from "./types";

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
}
