import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/.venv/**",
            "**/.uv-cache/**",
            "**/.pytest_cache/**",
            "**/dist/**",
            "**/build/**",
            "**/issuer-build/**",
            "**/.aws-sam/**",
            "**/coverage/**",
            "**/.lighthouseci/**",
            "**/playwright-report/**",
            "**/test-results/**",
            "**/*.tsbuildinfo",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ["**/*.{js,mjs,cjs,ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        "backend/core-case-service/drizzle.config.ts",
                        "frontend/app/vite.config.ts",
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
        files: ["frontend/app/**/*.{ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
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
    {
        ...tseslint.configs.disableTypeChecked,
        files: ["backend/core-case-service/tests/production/**/*.ts"],
        languageOptions: {
            ...tseslint.configs.disableTypeChecked.languageOptions,
            globals: {
                ...globals.node,
            },
        },
    },
    prettier,
];
