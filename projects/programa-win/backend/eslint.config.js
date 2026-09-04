import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Assets do navegador sao verificados por testes de contrato e pelo smoke real em Chrome.
  { ignores: ["node_modules/**", "web/**", "dist/**", ".pgdata/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["error"] }],
      "no-restricted-globals": ["error", { name: "localStorage", message: "PII nunca no cliente (CRIT-02)." }]
    }
  },
  {
    files: ["src/db/cli-*.ts", "src/lib/logger.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "no-console": "off" }
  }
);
