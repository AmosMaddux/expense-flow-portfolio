# Secure PR Gate Suppressions

The Secure PR Gate runs Semgrep, Bandit, OSV-Scanner, and Gitleaks on every pull request. The aggregate `Secure PR Gate` check fails if a scanner fails, errors, or is skipped. OSV blocks every known dependency vulnerability it reports, which is stricter than blocking only high-severity findings. Gitleaks blocks every suspected secret because secret findings do not have a severity threshold.

Fix a finding whenever possible. A suppression is allowed only after the Security team verifies that the finding is a false positive or that a time-bounded risk acceptance is justified. Never suppress a real credential. Revoke and rotate an exposed credential, remove it from the branch history, and rerun the gate.

## Approval Process

1. Record the scanner, finding ID or fingerprint, affected file or dependency, evidence that it is not exploitable, compensating controls, owner, and review-by date in the pull request.
2. Keep the exception as narrow as possible and set a review-by date no more than 90 days away.
3. Request approval from the Security CODEOWNER. The author of the suppression cannot be its sole approver.
4. Add the approved suppression using the scanner-specific format below.
5. Remove the suppression when the underlying finding is fixed. Before the review-by date, the owner must remove it or repeat this review and set a new date.

The metadata validator fails the PR when required metadata is absent, expired, or too broad.

## OSV-Scanner

Add only the exact advisory ID to the `[[IgnoredVulns]]` list in the root `osv-scanner.toml`. Broad `PackageOverrides` vulnerability ignores are prohibited.

```toml
[[IgnoredVulns]]
# owner = "platform-security"
id = "GHSA-synthetic-example"
ignoreUntil = 2026-11-17
reason = "Synthetic example: vulnerable code path is not included in the deployed artifact; tracked for upgrade in SCRUM-000."
```

CI passes the root config explicitly so its reviewed policy applies to every lockfile found by the recursive repository scan. Keep all OSV suppressions in this root file so the metadata validator and Security CODEOWNER cover them.

## Gitleaks

Use only the exact `Fingerprint` printed by the redacted Gitleaks output. Add it to `.gitleaksignore` immediately after one metadata line:

```text
# owner=platform-security; review-by=2026-11-17; reason=Synthetic fixture matches the rule but is not a credential.
0123456789012345678901234567890123456789:tests/fixtures/synthetic.txt:generic-api-key:4
```

Path or rule allowlists and inline allow directives are prohibited because they can hide unrelated future leaks. The PR gate explicitly loads the Security-owned `.gitleaks.toml`, rejects allowlists in that file, and disables inline allow directives. Do not put the suspected secret itself in the PR description, suppression rationale, source code, tests, logs, or documentation.
