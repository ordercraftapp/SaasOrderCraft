// src/lib/ai/prompts.ts

export function buildNamesPrompt(params: {
  category: string;
  cuisine: string;
  tone: string;
  audience: string;
  baseIngredients: string[];
  avoidAllergens: string[];
  count: number;
  language: string; // "es" | "en"
}) {
  const {
    category, cuisine, tone, audience,
    baseIngredients, avoidAllergens, count, language
  } = params;

  return `
You are a creative menu copywriter.
Language: ${language}.
Task: Propose ${count} DISTINCT dish names for the category "${category}".

Constraints:
- 3–5 words per name.
- Reflect cuisine: ${cuisine}. Tone: ${tone}. Audience: ${audience}.
- Prefer ingredients: ${baseIngredients.join(", ") || "chef's choice"}.
- Avoid allergens: ${avoidAllergens.join(", ") || "none"}.
- Return STRICT JSON: {"items":[{"name":"..."}]}
`.trim();
}

export function buildCopyPrompt(params: {
  names: string[];
  tone: string;
  language: string;
  seoKeywords: string[];
}) {
  const { names, tone, language, seoKeywords } = params;

  return `
You are a senior food copywriter.
Language: ${language}. Tone: ${tone}.
For each dish name, write JSON with:
- "description": 60–80 words, sensory, clear value, include 1–2 key ingredients.
- "seoTitle": one headline including 5+ of these keywords: ${seoKeywords.join(", ")}.
- "keywords": an array of 10 keywords (include long-tail).
Return STRICT JSON: {"items":[{"name":"X","description":"...","seoTitle":"...","keywords":[ "...", "..."]} ...]}

Dish names: ${names.map((n) => `"${n}"`).join(", ")}
`.trim();
}

export function buildImagePromptPrompt(params: {
  items: Array<{ name: string; ingredients?: string[] }>;
  language: string;
}) {
  const { items, language } = params;

  return `
You are an art director. Language: ${language}.
For each dish, create a single-line photorealistic prompt:
- Camera/light: natural light, shallow depth of field, 50mm, restaurant table.
- Composition: close-up on plate, subtle steam if hot, softly blurred background.
- Styling: modern, appetizing, no text/watermark, 16:9.
- Include dish elements & key ingredients when available.
Return STRICT JSON: {"items":[{"name":"...","imagePrompt":"..."}]}

Dishes: ${
  items
    .map((x) => `${x.name}${x.ingredients?.length ? " (" + x.ingredients.join(", ") + ")" : ""}`)
    .join(", ")
}
`.trim();
}
