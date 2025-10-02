# Session Kickoff (with MCPs)
1) Read `.assistant/assistant.yaml` and `.assistant/status.md`. If stale, refresh from plan/backlog/task_log.
2) Enumerate available MCP tools (context7, playwright, github) and where they help today.
3) Propose a 3–5 step plan mapped to MCPs (or "no tool" if not needed).
4) For each planned MCP step, draft: tool + arguments, expected outputs, target files/paths.
5) Execute the first step. After execution:
   - Append a structured log entry to `.assistant/task_log.md` (tool, args, result, artifacts).
   - Update `status.md` -> Artifacts if new files/reports exist.
6) If repo state changed or a task closed: update `backlog.md` and propose a commit message; if appropriate, create/update Issue/PR via GitHub MCP; log the URL.
7) Stop and show the plan + first results.
