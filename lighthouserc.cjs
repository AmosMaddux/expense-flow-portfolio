module.exports = {
    ci: {
        collect: {
            url: ["http://127.0.0.1:4173/finance-dashboard"],
            numberOfRuns: 3,
            puppeteerScript: "tests/lighthouse/authenticated-operator.cjs",
            chromePath: process.env.LIGHTHOUSE_CHROME_PATH,
            puppeteerLaunchOptions: {
                args: ["--no-sandbox"],
            },
            settings: {
                preset: "desktop",
                onlyCategories: ["performance", "accessibility"],
            },
        },
        assert: {
            aggregationMethod: "median-run",
            assertions: {
                "categories:performance": ["error", { minScore: 0.9 }],
                "categories:accessibility": ["error", { minScore: 0.9 }],
            },
        },
        upload: {
            target: "filesystem",
            outputDir: "test-results/lighthouse",
            reportFilenamePattern: "%%PATHNAME%%-%%DATETIME%%.%%EXTENSION%%",
        },
    },
};
