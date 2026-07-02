const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules", "prisma/migrations"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Strictness on top of eslint:recommended
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-console": "off",
      "no-throw-literal": "error",
      "require-await": "error",
      "no-return-await": "error",
    },
  },
  {
    // Vitest test files use global describe/it/expect/vi/etc.
    files: ["**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
];
