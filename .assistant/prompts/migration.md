# Migration Instructions (for existing projects)

We are migrating an older project into the `.assistant/` workflow.

## Steps
1. Review existing repo structure, README, docs, issues, commits.
2. Move vision/mission and design notes → `.assistant/canvas/`.
3. Extract known goals and TODOs → `.assistant/backlog.md` (with P-IDs, tags, accepts).
4. Create/update `.assistant/plan.md` (Now, Next, Later).
5. Write a condensed history of major milestones → `.assistant/history.md`.
6. Generate a fresh `.assistant/status.md` with:
   - Focus
   - Now/Next/Later (pointer to plan)
   - Risks
   - Artifacts
   - Changelog
   - **Open Questions synced from canvas/questions.md**
7. Propose ADR stubs for already-made architectural decisions.
8. Output a short “First session plan” so we can continue from here.

## Output
- A normalized `.assistant/` directory with backlog, plan, status, and history.
- ADR stubs for existing key decisions.
- Session plan for continuing development.
