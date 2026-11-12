# Main branch required checks

The repository had no active rulesets or legacy branch protection when this workflow was prepared. Secret scanning and push protection were already enabled.

After the new checks have registered successfully, configure an active branch ruleset targeting `refs/heads/main`. Require a pull request and these exact checks from GitHub Actions.

- `Aerynth required checks`
- `Aerynth governance`

The integration gate depends on Linux, Windows and security. It rejects missing, skipped, cancelled and failed dependencies. Require the aggregate so platform implementation names can evolve. Keep workflow and verification-code changes under maintainer review. Where available, bind each required check to its GitHub Actions source and limit bypasses to the repository's approved break-glass actors.

Use required up-to-date branches for direct PR merge, or require the merge queue if the repository elects to use one. Both required workflows listen for `merge_group` with `checks_requested`. Verify the rule on a real PR and, if enabled, a real queue entry. Confirm a docs-only PR still reports both checks, a failing dependency prevents merge, and a new passing revision can proceed. The post-merge `main` push also runs both workflows.

The security job adds GitHub dependency review for PR and merge-group revisions, a redacted Gitleaks scan and actionlint. Review covers new high and critical advisories. GitHub's dependency graph must be enabled and able to compare the relevant refs. Secret scanning and push protection remain repository-level settings.
