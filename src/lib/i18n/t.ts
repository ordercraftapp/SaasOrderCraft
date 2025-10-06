// src/lib/i18n/t.ts
import { MESSAGES } from "./messages";

/** Normaliza 'en-US', 'es-GT' -> 'en', 'es' y valida que exista en MESSAGES */
export function getLang(raw?: string): keyof typeof MESSAGES {
  const lc = (raw || "es").toLowerCase();
  const short = lc.split("-")[0] as keyof typeof MESSAGES; // "en-US" -> "en"
  return (short in MESSAGES ? short : "es");
}

/** Traduce por clave con fallback a la propia clave si no existe
 *  Ahora soporta interpolación: t(lang, "key", { name: "Ana", count: 3 })
 *  Ej.: "Hola {name}, tienes {count} mensajes"
 */
export function t(
  rawLang: string | undefined,
  key: string,
  vars?: Record<string, unknown>
): string {
  const lang = getLang(rawLang);
  let s = MESSAGES[lang]?.[key] ?? key;

  if (vars && typeof s === "string") {
    s = s.replace(/\{(\w+)\}/g, (_, k: string) =>
      Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null
        ? String(vars[k])
        : `{${k}}`
    );
  }

  return s;
}
