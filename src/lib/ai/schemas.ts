// src/lib/ai/schemas.ts
export type NameItem = { name: string };
export type NamesPayload = { items: NameItem[] };

export type CopyItem = {
  name: string;
  description: string;   // 60–80 palabras
  seoTitle: string;      // con 5+ keywords
  keywords: string[];    // 10 keywords
};
export type CopyPayload = { items: CopyItem[] };

export type ImagePromptItem = { name: string; imagePrompt: string };
export type ImagePromptsPayload = { items: ImagePromptItem[] };
