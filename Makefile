PROMPTS_DIR ?= .assistant/prompts

.PHONY: project-start session-start session-end migration print-project print-kickoff print-end print-migration

print-project:
	@echo "=== Project Startup ==="
	@cat $(PROMPTS_DIR)/project_startup.md

project-start: print-project
	@echo ">>> Paste above into gpt-5-codex in VS Code."

print-kickoff:
	@echo "=== Session Kickoff (MCP-aware) ==="
	@cat $(PROMPTS_DIR)/kickoff.md

print-end:
	@echo "=== End Session (MCP-aware) ==="
	@cat $(PROMPTS_DIR)/end_session.md

session-start: print-kickoff
	@echo ">>> Paste above into gpt-5-codex in VS Code."

session-end: print-end
	@echo ">>> Paste above into gpt-5-codex in VS Code."

print-migration:
	@echo "=== Migration ==="
	@cat $(PROMPTS_DIR)/migration.md

migration: print-migration
	@echo ">>> Paste above into gpt-5-codex in VS Code."
