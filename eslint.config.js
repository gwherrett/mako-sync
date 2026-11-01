import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// eslint-plugin-react-hooks 7 adds the React Compiler rules to `recommended` as
// errors. Report them as warnings until the existing findings are fixed; only
// rules-of-hooks stays an error.
const reactHooksRules = Object.fromEntries(
  Object.entries(reactHooks.configs.recommended.rules).map(([rule, level]) => [
    rule,
    rule === "react-hooks/rules-of-hooks" ? level : "warn",
  ])
);

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooksRules,
      // New in @eslint/js 10 recommended; warn until the existing findings are fixed
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  }
);
