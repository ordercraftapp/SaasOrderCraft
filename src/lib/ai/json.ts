// src/lib/ai/json.ts
export function safeJsonParse<T = any>(text: string): T {
  try {
    // intenta parsear el texto completo
    return JSON.parse(text) as T;
  } catch {
    // intenta extraer el primer bloque {...}
    const match = text.match(/\{[\s\S]*\}$/m);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch {}
    }
    // intenta extraer arreglo [...]
    const matchArr = text.match(/\[[\s\S]*\]$/m);
    if (matchArr) {
      try { return JSON.parse(matchArr[0]) as T; } catch {}
    }
    throw new Error("Invalid JSON from model");
  }
}
