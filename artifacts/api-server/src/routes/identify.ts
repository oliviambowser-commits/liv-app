import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { aiUsageEvents, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { VISION_MODEL, estimateOpenAICost } from "../ai/model-router";
import { OpenAIResponsesProvider } from "../ai/openai-responses-provider";

const router: IRouter = Router();
const provider = new OpenAIResponsesProvider();
const MAX_BASE64_LENGTH = 7_000_000; // about 5 MB of image data

const identifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Liv is reading a lot of photos right now. Please try again in a minute." },
});

router.post("/liv/identify", identifyLimiter, async (req, res) => {
  const raw = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : "";
  const image = raw.replace(/^data:image\/[a-z]+;base64,/i, "").replace(/\s/g, "");
  if (!image || image.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+=*$/.test(image)) {
    res.status(400).json({ message: "Send one JPEG or PNG photo under 5 MB." });
    return;
  }
  // Photos are passed straight to the AI provider and never stored by Liv.
  const mediaType = image.startsWith("iVBOR") ? "image/png" : "image/jpeg";
  const startedAt = performance.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;
  let errorCategory: string | null = null;

  try {
    const result = await provider.identifyFromImage({ imageBase64: image, mediaType, model: VISION_MODEL });
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    success = true;
    res.json(result.identification);
  } catch (error) {
    errorCategory = error instanceof Error ? error.name.slice(0, 80) : "unknown";
    logger.warn({ err: error }, "Liv photo identification failed");
    res.status(502).json({ message: "Liv couldn't read the photo right now. Please try again." });
  } finally {
    await db
      .insert(aiUsageEvents)
      .values({
        provider: provider.name,
        model: VISION_MODEL,
        route: "liv_identify",
        inputTokens,
        outputTokens,
        webSearchCalls: 0,
        latencyMs: Math.round(performance.now() - startedAt),
        estimatedCostUsd: estimateOpenAICost(VISION_MODEL, inputTokens, outputTokens, 0),
        catalogCacheHit: false,
        success,
        errorCategory,
      })
      .catch((metricError) => logger.warn({ err: metricError }, "Could not persist AI usage metric"));
  }
});

export default router;
