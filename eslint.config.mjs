import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/coverage/**",
            "**/*.tsbuildinfo",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        "backend/core-case-service/drizzle.config.ts",
                        "backend/identity-auth-service/drizzle.config.ts",
                        "vitest.config.ts",
                    ],
                },
            },
        },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
        },
    },
    {
        ...tseslint.configs.disableTypeChecked,
        files: ["**/*.{js,mjs,cjs}"],
        languageOptions: {
            ...tseslint.configs.disableTypeChecked.languageOptions,
            globals: {
                ...globals.node,
            },
        },
    },
    prettier,
];
