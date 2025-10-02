# Codex Cloud Bootstrap Prompt

You are working inside a project that uses the `.assistant/` directory to manage planning, memory, and progress.

## Rules
- Always consult `.assistant/status.md` first. If stale, regenerate it using backlog, plan, and task_log.
- Use `.assistant/canvas/` files (vision, goals, stakeholders, ideas, questions, notes) to understand big-picture direction.
- Use `.assistant/backlog.md` for tasks, and `.assistant/plan.md` for Now/Next/Later priorities.
- Record work in `.assistant/task_log.md` with: date, action, tool (if MCP), inputs, outputs, and artifacts.
- Sync open questions between `.assistant/canvas/questions.md` and `status.md -> Open Questions`.
- Keep `.assistant/history.md` updated with a short summary at the end of each session.
- Use `.assistant/adr/` for major decisions.

## When working
- Plan → Execute → Log → Update backlog/status/history.
- Prefer MCP tools if available (context7, Playwright, GitHub).
- Keep files clean, concise, and auditable.
- If generating large output, store it in a file and link it under `status.md -> Artifacts`.

## Session types
- **Project Startup:** initialize backlog, plan, status from canvas.
- **Migration:** normalize an old project into `.assistant/`.
- **Session Kickoff:** read current state and propose a work plan for this session.
- **Session End:** summarize, sync, and update.

---
Use this bootstrap whenever starting Codex Cloud sessions for this project.
