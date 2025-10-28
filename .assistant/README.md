# Assistant Workspace Guide

## Backlog Sections
- **Done**: Completed scope. Keep the original tags, dependencies, estimates, acceptance criteria, and notes for historical context.
- **Current**: Active or near-term priorities. These should match the “Now” and “Next” lanes in `.assistant/plan.md` and the Status report.
- **On Hold**: Work paused or deemed unnecessary for now. Include a dated note describing why it is parked and what signal should trigger reactivation or removal.
- **Tracking**: Aggregates work related to posting data back to Matomo. Use this lane when the product emphasis shifts or when tracking is suspended.
- **Future**: Planned but not being worked immediately. Revisit when reprioritising quarterly or when capacity frees up.
- **Ice Box**: Low-priority or exploratory ideas. Leave empty unless there is work explicitly deferred with no target date.

## Maintenance Workflow
1. Update the backlog first and preserve metadata on every task.
2. Reflect the same prioritisation in `.assistant/plan.md` and `.assistant/status.md`.
3. Log significant reorganisations in `.assistant/task_log.md` for traceability.
4. Reference new artifacts (docs, templates, runbooks) from the Status report’s Artifacts section.

-## Creating GitHub Issues
- Use `scripts/create_backlog_issues.sh` (defaults to `authorityab/OpalMind`) or pass `<owner/repo>` explicitly to promote Current and Future tasks into GitHub issues.
- Run once in dry-run mode (default) to review the generated titles/bodies/labels.
- After confirming, run with `DRY_RUN=false scripts/create_backlog_issues.sh <owner/repo>` to create issues via the GitHub CLI. Missing labels are auto-created with reasonable defaults, and existing open issues with the same title are skipped.
- Ensure `gh` is authenticated with access to open issues in the target repository.
