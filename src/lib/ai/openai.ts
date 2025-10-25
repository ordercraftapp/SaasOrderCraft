// src/lib/ai/openai.ts
import OpenAI from "openai";

/** Falla temprano si falta la API key (mejor que 500 silenciosos en producción). */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[openai] Missing required env var: ${name}`);
  }
  return v;
}

/** Client para llamadas server-side (rutas con runtime = "nodejs"). */
export const openai = new OpenAI({
  apiKey: requireEnv("OPENAI_API_KEY"),
  // opcional: organization: process.env.OPENAI_ORG_ID,
  // opcional (Azure/OpenAI-compatible): baseURL: process.env.OPENAI_BASE_URL,
});

/** Modelo por defecto; puedes cambiarlo a "gpt-4o" si quieres máxima calidad. */
export const OPENAI_MODEL_ID: string =
  process.env.OPENAI_MODEL_ID || "gpt-4o-mini";
