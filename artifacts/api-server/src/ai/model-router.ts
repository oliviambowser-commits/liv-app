export type AIModel = "gpt-6-luna" | "gpt-6.1-sol";

export function chooseModel(question: string, historyLength: number): AIModel {
  const complex =
    historyLength >= 4 ||
    /\b(compare|comparison|research|evidence|sources|conflict|ingredients|formulation|why|evaluate|analyze)\b/i.test(
      question,
    ) ||
    question.length > 260;
  return complex ? "gpt-6.1-sol" : "gpt-6-luna";
}

export function estimateOpenAICost(
  model: AIModel,
  inputTokens: number,
  outputTokens: number,
  webSearchCalls: number,
) {
  const rates = model === "gpt-6.1-sol"
    ? { input: 2, output: 10 }
    : { input: 0.1, output: 0.5 };
  return (
    (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000 +
    webSearchCalls * 0.01
  );
}
