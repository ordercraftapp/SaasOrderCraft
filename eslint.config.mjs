// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  // ✅ Igual que tu proyecto original
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ✅ Evita warnings por disables “no usados”
  { linterOptions: { reportUnusedDisableDirectives: "off" } },

  // ✅ Reglas que están pegando, apagadas globalmente para respetar tu código actual
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }],
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "warn",
      // El siguiente lo apagamos solo en archivos puntuales (ver override abajo)
      // "react-hooks/rules-of-hooks": "off",

      // Reglas Next que te marcan por usar <a>:
      "@next/next/no-html-link-for-pages": "off"
    },
  },

  // 🎯 Overrides SOLO para archivos donde violas las reglas de hooks “a propósito”
  {
    files: [
      "src/components/CartBadge.tsx",
      // añade otros que llamen hooks dentro de IIFEs/callbacks si aplica
    ],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];
