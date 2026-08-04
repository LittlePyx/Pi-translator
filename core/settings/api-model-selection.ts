const NON_CHAT_MODEL = /(?:^|[-/:._])(?:embed(?:ding)?|rerank|moderation|whisper|tts|speech|audio|image-generation|text-to-image|video)(?:$|[-/:._])/iu;

const TEXT_MODEL_HINT = /(?:^|[-/:._])(?:chat|instruct|reasoner|assistant|plus|pro|flash|turbo|latest)(?:$|[-/:._])/iu;

const VISION_MODEL_HINT = /(?:^|[-/:._])(?:vision|vl|omni|multimodal|4o|4\.1|5|gemini|claude|glm-4v|kimi-vl)(?:$|[-/:._])/iu;

function normalizeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of models) {
    const model = value.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    normalized.push(model);
  }
  return normalized;
}

function textModelScore(model: string): number {
  if (NON_CHAT_MODEL.test(model)) return -100;
  let score = 0;
  if (TEXT_MODEL_HINT.test(model)) score += 20;
  if (VISION_MODEL_HINT.test(model)) score -= 3;
  if (/preview|experimental|deprecated/iu.test(model)) score -= 8;
  return score;
}

export function recommendedTextModel(
  models: string[],
  preferred = '',
): string | undefined {
  const available = normalizeModels(models);
  const exact = available.find((model) => model === preferred.trim());
  if (exact && !NON_CHAT_MODEL.test(exact)) return exact;

  return available
    .map((model, index) => ({ model, index, score: textModelScore(model) }))
    .filter(({ score }) => score > -100)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.model;
}

function likelyVisionModel(model: string): boolean {
  if (NON_CHAT_MODEL.test(model)) return false;
  return VISION_MODEL_HINT.test(model) ||
    /qwen(?:2(?:\.5)?|3(?:\.\d+)?)?(?:[-/:._].*)?(?:plus|max|pro)/iu.test(model);
}

export function recommendedVisionModelCandidates(
  models: string[],
  textModel: string,
  preferred = '',
  limit = 4,
): string[] {
  const available = normalizeModels(models);
  const candidates: string[] = [];
  const append = (model: string): void => {
    const trimmed = model.trim();
    if (!trimmed || NON_CHAT_MODEL.test(trimmed) || candidates.includes(trimmed)) return;
    if (available.length && !available.includes(trimmed)) return;
    candidates.push(trimmed);
  };

  append(preferred);
  append(textModel);
  for (const model of available.filter(likelyVisionModel)) append(model);
  return candidates.slice(0, Math.max(1, limit));
}

