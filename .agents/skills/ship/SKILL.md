---
name: ship
description: "Automates shipping, deploying to main, rollout, release versioning, updating src/app/changelog.ts, running unit/e2e tests, merging git worktrees, cleaning up active ports, and monitoring GitHub Actions CI. Trigger automatically when the user asks to deploy, rollout, release, ship, or merge changes to production, or on /ship."
---

# Ship Feature Skill (/ship)

This skill automates the complete process of merging a feature branch from a Git worktree to `main`, cleaning up local resources, and verifying the remote deployment status.

## Routing Instructions

All deterministic execution steps are handled by the Bun-based automation script located at [ship.ts](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/tools/ship.ts).

### Running the Entire Workflow
When the user types `/ship` or asks to deploy/merge a worktree:

> [!CAUTION]
> **GOVERNANCE RULE FOR AGENTS**: You (the AI Agent) are strictly forbidden from performing Phase 4 (Push to main) or passing the `--approve` flag unless you have first explicitly asked the user in chat: *"Do you approve merging and deploying to main?"* and received an explicit confirmation of approval. If they have approved it, append the `--approve` flag.

1. Identify the worktree directory name or branch.
2. Confirm approval with the user in the chat interface.
3. Run the automation script:
   ```bash
   bun .agents/skills/ship/tools/ship.ts --approve
   ```

### Running Specific Phases
The script supports granular execution. Translate the user request to appropriate flags:
- **Commit changes**: `bun .agents/skills/ship/tools/ship.ts --commit` or `--message "MSG"`
- **Sync feature branch with main**: `bun .agents/skills/ship/tools/ship.ts --sync` (or add `--rebase` for rebasing)
- **Run tests**: `bun .agents/skills/ship/tools/ship.ts --test`
- **Skip tests**: `bun .agents/skills/ship/tools/ship.ts --no-test`
- **Merge and push to remote**: `bun .agents/skills/ship/tools/ship.ts --push --approve` (always requires `--approve` for non-interactive agent execution)
- **Clean up resources**: `bun .agents/skills/ship/tools/ship.ts --cleanup` (deletes worktree, local/remote branch, and frees ports)
- **Monitor CI/CD deployment**: `bun .agents/skills/ship/tools/ship.ts --monitor`

If the user wants to run **only** a specific action without the rest of the pipeline, append the `--only` flag (e.g., `bun .agents/skills/ship/tools/ship.ts --cleanup --only`).

## Detailed Reference
For an in-depth breakdown of the underlying Git commands and verification steps of each phase, refer to the individual workflow documentation:
* **Stage 1 (Commit)**: [commit.md](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/workflows/commit.md)
* **Stage 2 (Sync)**: [sync.md](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/workflows/sync.md)
* **Stage 3 (Test)**: [test.md](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/workflows/test.md)
* **Stage 4 (Push)**: [push.md](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/workflows/push.md)
* **Stage 5 (Cleanup)**: [cleanup.md](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/workflows/cleanup.md)
* **Stage 6 (Monitor)**: [monitor.md](file:///Users/mateuscarniatto/dev/PokerPlanningNeo/.agents/skills/ship/workflows/monitor.md)
