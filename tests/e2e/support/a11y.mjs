import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

/**
 * Runs axe and fails when serious or critical violations are present.
 */
export async function expectNoSeriousOrCriticalAxeViolations(
    page,
    testInfo,
    screenName,
) {
    const results = await new AxeBuilder({ page }).analyze();
    const blockingViolations = results.violations.filter(
        (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
    );

    await testInfo.attach(`${screenName.toLowerCase()}-axe-results`, {
        body: JSON.stringify(results, null, 2),
        contentType: "application/json",
    });

    if (results.violations.length > 0) {
        console.log(formatViolationSummary(screenName, results.violations));
    }

    expect(
        blockingViolations,
        formatViolationFailure(screenName, blockingViolations),
    ).toEqual([]);
}

function formatViolationSummary(screenName, violations) {
    return [
        `${screenName} axe violations: ${violations.length}`,
        ...violations.map(
            (violation) =>
                `- ${violation.id} (${violation.impact ?? "unknown"}): ${violation.nodes.length} node(s)`,
        ),
    ].join("\n");
}

function formatViolationFailure(screenName, violations) {
    if (violations.length === 0) {
        return `${screenName} has no serious or critical axe violations.`;
    }

    return [
        `${screenName} has ${violations.length} serious or critical axe violation(s):`,
        ...violations.map(formatViolation),
    ].join("\n\n");
}

function formatViolation(violation) {
    const selectors = violation.nodes
        .map((node) => {
            const target = node.target.join(", ");
            const summary =
                node.failureSummary === undefined
                    ? ""
                    : `\n    ${node.failureSummary.replace(/\n/g, "\n    ")}`;

            return `  - ${target}${summary}`;
        })
        .join("\n");

    return [
        `Rule: ${violation.id}`,
        `Impact: ${violation.impact ?? "unknown"}`,
        `Description: ${violation.description}`,
        `Help: ${violation.helpUrl}`,
        "Affected nodes:",
        selectors,
    ].join("\n");
}
