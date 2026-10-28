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

export interface AIProvider {
  readonly name: string;
  research(request: ResearchRequest): Promise<ResearchResult>;
}
