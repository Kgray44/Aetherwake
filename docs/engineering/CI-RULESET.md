# Main branch required checks

The repository had no active rulesets or legacy branch protection when this workflow was prepared. Secret scanning and push protection were already enabled.

After the new checks have registered successfully, configure an active branch ruleset targeting `refs/heads/main`. Require a pull request and these exact checks from GitHub Actions.

- `Aerynth required checks`
- `Aerynth governance`

The integration gate depends on Linux, Windows and security. It rejects missing, skipped, cancelled and failed dependencies. Require the aggregate so platform implementation names can evolve. Also require maintainer approval for workflow and verification-code changes. Binding a check to GitHub Actions alone does not protect its editable workflow definition. Where available, bind each required check to its GitHub Actions source and limit bypasses to the repository's approved break-glass actors.

Use required up-to-date branches for direct PR merge, or require the merge queue if the repository elects to use one. Both required workflows listen for `merge_group` with `checks_requested`. Verify the rule on a real PR and, if enabled, a real queue entry. Confirm a docs-only PR still reports both checks, a failing dependency prevents merge, and a new passing revision can proceed. The post-merge `main` push also runs both workflows.

The security job audits all tracked npm lockfiles for high and critical advisories and runs redacted Gitleaks and actionlint. It uses npm audit directly because GitHub's dependency graph is disabled for this repository. Secret scanning and push protection remain repository-level settings.
