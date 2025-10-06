import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const OPENAI_MODEL_ID =
  process.env.OPENAI_MODEL_ID || "gpt-4o-mini";
