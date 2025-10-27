#!/usr/bin/env bash

# create_backlog_issues.sh
# ------------------------
# Create GitHub issues for the active backlog (Current + Future sections).
# Requires the GitHub CLI (`gh`) authenticated with permissions to open issues.
# Run in dry-run mode (default) to review content, then export DRY_RUN=false to actually create issues.

set -euo pipefail

REPO="${1:-authorityab/OpalMind}"
DRY_RUN="${DRY_RUN:-true}"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required (https://cli.github.com/)" >&2
  exit 1
fi

if [[ "${DRY_RUN}" != "true" ]]; then
  gh repo view "${REPO}" >/dev/null
fi

declare -A LABEL_COLORS=(
  ["backlog"]="ededed"
  ["priority:high"]="d73a4a"
  ["priority:medium"]="fbca04"
  ["priority:low"]="0e8a16"
  ["tag:infrastructure"]="0366d6"
  ["tag:reliability"]="0b5ed7"
  ["tag:feature"]="5319e7"
  ["tag:sdk"]="a333c8"
  ["tag:config"]="0052cc"
  ["tag:multi-tenant"]="5319e7"
  ["tag:infra"]="0366d6"
  ["tag:observability"]="5319e7"
  ["tag:ops"]="0052cc"
  ["tag:docs"]="66c2a5"
  ["tag:dx"]="66c2a5"
  ["tag:security"]="c11b17"
  ["tag:devex"]="6f42c1"
  ["tag:analytics"]="6f42c1"
  ["tag:ux"]="6f42c1"
  ["tag:bug"]="d73a4a"
  ["tag:api"]="0b5ed7"
  ["tag:maintenance"]="0052cc"
  ["tag:build"]="0052cc"
)

declare -A LABEL_DESCRIPTIONS=(
  ["backlog"]="Tracked via .assistant/backlog.md"
  ["priority:high"]="Must land in current milestone"
  ["priority:medium"]="Important but not blocking release"
  ["priority:low"]="Opportunistic or nice-to-have"
)

declare -A CREATED_LABELS=()

ensure_label() {
  local label="$1"
  local color="${LABEL_COLORS[$label]:-ededed}"
  local description="${LABEL_DESCRIPTIONS[$label]:-}"

  if [[ -n "${CREATED_LABELS[$label]:-}" ]]; then
    return
  fi

  if gh label view "${label}" --repo "${REPO}" >/dev/null 2>&1; then
    CREATED_LABELS[$label]=1
    return
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[dry-run] Missing label ${label}; would create with color ${color}"
    return
  fi

  echo "Creating missing label '${label}'"
  if [[ "${description}" == "-" ]]; then
    if gh label create "${label}" --color "${color}" --repo "${REPO}"; then
      CREATED_LABELS[$label]=1
    else
      echo "[warn] Unable to create label '${label}', continuing..."
    fi
  else
    if gh label create "${label}" --color "${color}" --description "${description}" --repo "${REPO}"; then
      CREATED_LABELS[$label]=1
    else
      echo "[warn] Unable to create label '${label}', continuing..."
    fi
  fi
}

create_issue() {
  local title="$1"
  local body="$2"
  shift 2
  local labels=("$@")

  echo "------------------------------------------------------------"
  echo "Title: ${title}"
  echo "Labels: ${labels[*]:-(none)}"
  echo "Body:"
  echo "${body}"
  echo "------------------------------------------------------------"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[dry-run] Skipping issue creation for ${title}"
    return
  fi

  for label in "${labels[@]}"; do
    ensure_label "${label}"
  done

  local gh_args=(issue create --repo "${REPO}" --title "${title}" --body "${body}")
  for label in "${labels[@]}"; do
    gh_args+=(--label "${label}")
  done

  gh "${gh_args[@]}"
}

create_issue \
  "P-005: Persist retry queue and cache state" \
  "$(cat <<'EOF'
## Summary
Persist the tracking retry queue and cache so restarts do not drop in-flight work and operators understand the storage requirements.

## Acceptance Criteria
- [ ] Queue/cache survive restarts via agreed storage (e.g., Redis) with configuration docs and migration notes.

## Dependencies
- ADR-0003

## Context
- Tags: infrastructure, reliability
- Priority: medium
- Estimate: 2d
EOF
)" \
  "backlog" "priority:medium" "tag:infrastructure" "tag:reliability"

create_issue \
  "P-006a: Harden funnel analytics flow outputs" \
  "$(cat <<'EOF'
## Summary
Ensure funnel analytics helpers return consistent step definitions and metrics across Matomo variants, with clear fallbacks and tests.

## Acceptance Criteria
- [ ] Normalize funnel step metadata so API/SDK responses align across Matomo variants.
- [ ] Document known funnel data limitations and required configuration.
- [ ] Add regression tests covering multi-step flows and degraded responses.

## Dependencies
- P-006

## Context
- Tags: feature, sdk
- Priority: medium
- Estimate: 1d
EOF
)" \
  "backlog" "priority:medium" "tag:feature" "tag:sdk"

create_issue \
  "P-010: Support multi-site indexing and configuration" \
  "$(cat <<'EOF'
## Summary
Allow operators to configure multiple Matomo sites per deployment, keeping analytics routing and documentation aligned with real-world multi-site setups.

## Acceptance Criteria
- [ ] Support a site-name → siteId mapping via JSON/YAML (env var or well-known path) with refresh guidance.
- [ ] Parse user queries for site names, resolve to siteIds, and collate comparative analytics (e.g., dual GetKeyNumbers calls).
- [ ] Document configuration schema, mounting strategy, and known limits.

## Dependencies
- ADR-0001

## Notes
- Previous work exists on branch `feature-P010`.
- Consider hydrating the map dynamically via `SitesManager.getAllSitesId`.

## Context
- Tags: feature, config, multi-tenant
- Priority: high
- Estimate: 2d
EOF
)" \
  "backlog" "priority:high" "tag:feature" "tag:config" "tag:multi-tenant"

create_issue \
  "P-018: Bound caches and idempotency stores" \
  "$(cat <<'EOF'
## Summary
Add TTLs and maximum size limits for reporting caches and tracking retry/idempotency stores so memory usage stays bounded and observable.

## Acceptance Criteria
- [ ] Introduce TTL and maximum size limits for reporting cache and tracking retry/idempotency stores.
- [ ] Expose eviction metrics and operational visibility.
- [ ] Validate bounded behaviour under load via tests.

## Dependencies
- ADR-0003

## Context
- Tags: reliability, infra
- Priority: high
- Estimate: 1d
EOF
)" \
  "backlog" "priority:high" "tag:reliability" "tag:infra"

create_issue \
  "P-019: Instrument health endpoint with real queue metrics" \
  "$(cat <<'EOF'
## Summary
Expose actual tracking queue depth/state and rate-limit failures through the health endpoint so SREs gain actionable observability.

## Acceptance Criteria
- [ ] Report real tracking queue depth/state from `/tools/get-health-status`.
- [ ] Reflect Matomo rate-limit failures in the health response.
- [ ] Update docs/tests so health tooling surfaces accurate queue insights.

## Dependencies
- P-002
- P-016

## Context
- Tags: observability, ops
- Priority: high
- Estimate: 1d
EOF
)" \
  "backlog" "priority:high" "tag:observability" "tag:ops"

create_issue \
  "P-020: Align authentication documentation with implementation" \
  "$(cat <<'EOF'
## Summary
Ensure documentation mirrors the current authenticated routes and observability guarantees delivered by the API.

## Acceptance Criteria
- [ ] Update README and monitoring docs to describe authenticated routes accurately.
- [ ] Align observability promises with what health endpoints actually deliver.
- [ ] Call out remaining roadmap gaps so operators know what is pending.

## Dependencies
- B-003

## Context
- Tags: docs, developer-experience
- Priority: medium
- Estimate: 0.5d
EOF
)" \
  "backlog" "priority:medium" "tag:docs" "tag:dx"

create_issue \
  "B-016: Enforce structured logging and lint rules" \
  "$(cat <<'EOF'
## Summary
Standardise logging practices by adopting a redacted logger utility and banning raw console usage through lint rules.

## Acceptance Criteria
- [ ] Standardise on the redacted logger utility across the codebase.
- [ ] Enforce lint rules that block raw `console.*` calls with security plugin support.
- [ ] Migrate existing logs and ensure CI enforces the rule set.

## Dependencies
- ADR-0001

## Context
- Tags: security, developer-experience
- Priority: low
- Estimate: 0.75d
EOF
)" \
  "backlog" "priority:low" "tag:security" "tag:devex"

create_issue \
  "B-017: Tighten TypeScript compiler strictness" \
  "$(cat <<'EOF'
## Summary
Adopt stricter TypeScript compiler settings to surface typing issues earlier and document the policy for contributors.

## Acceptance Criteria
- [ ] Enable `noImplicitAny`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.
- [ ] Resolve resulting type errors across API and SDK packages.
- [ ] Document the stricter typing policy in contributor guides.

## Dependencies
- ADR-0001

## Context
- Tags: security, developer-experience
- Priority: low
- Estimate: 1d
EOF
)" \
  "backlog" "priority:low" "tag:security" "tag:devex"

create_issue \
  "P-002c: Compute comparative period deltas for reports" \
  "$(cat <<'EOF'
## Summary
Extend reporting tools to compute current vs prior period deltas with percentage indicators and documentation.

## Acceptance Criteria
- [ ] Fetch current and prior periods for each metric in reporting tools.
- [ ] Compute percentage deltas with up/down indicators handling zero-baseline cases.
- [ ] Expose the results via SDK/UI with updated documentation.

## Dependencies
- P-002

## Context
- Tags: analytics, user-experience
- Priority: medium
- Estimate: 1.5d
EOF
)" \
  "backlog" "priority:medium" "tag:analytics" "tag:ux"

create_issue \
  "B-006: Support decimal inputs in numeric parsing" \
  "$(cat <<'EOF'
## Summary
Allow decimal-safe handling for numeric parameters (e.g., revenue) while keeping validation strict for invalid values.

## Acceptance Criteria
- [ ] Replace integer-only parsing with decimal-safe handling for numeric parameters.
- [ ] Preserve validation errors for invalid numeric inputs.
- [ ] Add test coverage for decimal scenarios.

## Dependencies
- none

## Context
- Tags: bug, api
- Priority: medium
- Estimate: 0.25d
EOF
)" \
  "backlog" "priority:medium" "tag:bug" "tag:api"

create_issue \
  "P-007: Publish Opal discovery integration guide" \
  "$(cat <<'EOF'
## Summary
Produce documentation that helps teams adopt the Opal discovery workflow with references, checklists, and examples.

## Acceptance Criteria
- [ ] Add discovery payload reference and onboarding checklist to docs.
- [ ] Provide sample tool invocations kept in sync with code.
- [ ] Ensure guidance aligns with deployment realities.

## Dependencies
- ADR-0001

## Context
- Tags: docs, developer-experience
- Priority: low
- Estimate: 1d
EOF
)" \
  "backlog" "priority:low" "tag:docs" "tag:dx"

create_issue \
  "P-008: Introduce structured logging pipeline" \
  "$(cat <<'EOF'
## Summary
Replace ad-hoc logging with a structured pipeline routed to standard output and documented for operators.

## Acceptance Criteria
- [ ] Adopt a structured logger and replace console logging.
- [ ] Document log levels and expectations for production deployments.
- [ ] Ensure logs remain redacted and security-compliant.

## Dependencies
- ADR-0002

## Context
- Tags: ops, observability
- Priority: low
- Estimate: 1d
EOF
)" \
  "backlog" "priority:low" "tag:ops" "tag:observability"

create_issue \
  "P-009: Lean build and dependency audit" \
  "$(cat <<'EOF'
## Summary
Audit the codebase to remove unused code, dependencies, and build artefacts, documenting any intentional exceptions.

## Acceptance Criteria
- [ ] Remove unused code/dependencies/build artefacts where safe.
- [ ] Document deletions or exemptions to keep the codebase minimal.
- [ ] Ensure build and tests remain green post-audit.

## Dependencies
- ADR-0001
- ADR-0002
- ADR-0003

## Context
- Tags: maintenance, build
- Priority: medium
- Estimate: 1d
EOF
)" \
  "backlog" "priority:medium" "tag:maintenance" "tag:build"

create_issue \
  "P-011: Add goal analytics helpers" \
  "$(cat <<'EOF'
## Summary
Expose goal analytics helpers via API tools with data normalization, documentation, and test coverage.

## Acceptance Criteria
- [ ] Provide goal analytics helpers accessible through API tools.
- [ ] Normalize goal data to consistent shapes across Matomo responses.
- [ ] Update docs and add test coverage for goal summaries.

## Dependencies
- ADR-0001

## Context
- Tags: feature, sdk
- Priority: medium
- Estimate: 1.5d
EOF
)" \
  "backlog" "priority:medium" "tag:feature" "tag:sdk"

create_issue \
  "P-012: Add cohort retention analytics" \
  "$(cat <<'EOF'
## Summary
Deliver cohort and retention analytics helpers that surface repeat visit cadence, churn metrics, and stickiness insights.

## Acceptance Criteria
- [ ] Provide cohort/retention helpers covering repeat visits and churn.
- [ ] Document how to interpret the metrics and integrate them.
- [ ] Add regression tests for representative cohort scenarios.

## Dependencies
- ADR-0001

## Context
- Tags: feature, analytics
- Priority: medium
- Estimate: 2d
EOF
)" \
  "backlog" "priority:medium" "tag:feature" "tag:analytics"

create_issue \
  "P-013: Add campaign acquisition analytics" \
  "$(cat <<'EOF'
## Summary
Provide helpers for campaign/channel breakdowns (UTMs, conversions) exposed via API tools with documentation and tests.

## Acceptance Criteria
- [ ] Deliver campaign acquisition helpers covering UTMs and conversions.
- [ ] Expose helpers through assistants/API interfaces.
- [ ] Update docs and add representative tests.

## Dependencies
- ADR-0001

## Context
- Tags: feature, analytics
- Priority: medium
- Estimate: 1.5d
EOF
)" \
  "backlog" "priority:medium" "tag:feature" "tag:analytics"

create_issue \
  "P-014: Add event flow analytics" \
  "$(cat <<'EOF'
## Summary
Implement event flow analytics that reveal entry-to-exit journeys, drop-off detection, and assistant exposure.

## Acceptance Criteria
- [ ] Implement entry→exit journey/path reports with drop-off detection.
- [ ] Expose results through assistants and document usage.
- [ ] Add test coverage for representative flow scenarios.

## Dependencies
- ADR-0001

## Context
- Tags: feature, analytics
- Priority: medium
- Estimate: 2d
EOF
)" \
  "backlog" "priority:medium" "tag:feature" "tag:analytics"

create_issue \
  "P-015: Add site search analytics helpers" \
  "$(cat <<'EOF'
## Summary
Surface internal site search terms, zero-result queries, and follow-up actions via API tools with supporting docs/tests.

## Acceptance Criteria
- [ ] Provide helpers surfacing internal site search terms and zero-result queries.
- [ ] Document how to consume the new analytics.
- [ ] Add tests verifying helper behaviour across key scenarios.

## Dependencies
- ADR-0001

## Context
- Tags: feature, analytics
- Priority: low
- Estimate: 1d
EOF
)" \
  "backlog" "priority:low" "tag:feature" "tag:analytics"
