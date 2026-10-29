export type ConversationTurn = { role: "user" | "assistant"; content: string };
export type SourceCitation = { title: string; url: string };

export type ResearchRequest = {
  prompt: string;
  model: string;
  useWebSearch: boolean;
  approvedDomains: string[];
};

export type ResearchResult = {
  text: string;
  citations: SourceCitation[];
  inputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
};

// A photo alone never "confirms" a product: formulas and sizes change
// without the front of the package changing. Only a barcode match confirms.
export type PackageIdentification = {
  status: "probable" | "unverified" | "unreadable";
  brand: string | null;
  productName: string | null;
  variant: string | null;
  size: string | null;
  category: string | null;
  barcodeDigits: string | null;
  visibleText: string[];
  notes: string;
};

export type IdentifyRequest = {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png";
  model: string;
};

export type IdentifyResult = {
  identification: PackageIdentification;
  inputTokens: number;
  outputTokens: number;
};

/** Web research that must return JSON matching `schema`. */
export type StructuredResearchRequest = {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
};

export type StructuredResearchResult = {
  data: unknown;
  /** Every URL the model actually saw: search results, opened pages, citations. */
  seenUrls: string[];
  inputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
};

export interface AIProvider {
  readonly name: string;
  research(request: ResearchRequest): Promise<ResearchResult>;
  identifyFromImage(request: IdentifyRequest): Promise<IdentifyResult>;
  structuredWebResearch(request: StructuredResearchRequest): Promise<StructuredResearchResult>;
}
