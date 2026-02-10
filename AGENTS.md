# AGENTS

## Ground rules
- Do not use the pacakge "server-only" in the project
- Do not edit any `*/migration/*` files; they are auto-generated.
- Do not add legacy support; updates should be clean and avoid extra project complexity.
- Ignore all license related issues
- Project uses `Bun` pacakge manager with turborepo
- Prefer removing lines of code over adding more lines of code to reduce complexity

## Planning
- Start with a detailed, concrete plan before changes.
- Include ordered steps, affected files/areas, key decisions, risks/unknowns, assumptions, and validation steps.
- Call out dependencies, sequence/rollout considerations, and any backout/rollback approach if relevant.
- Plans must be fully resolved: no open questions, pending decisions, or research tasks should remain in the plan.
- Update the plan as work progresses to reflect what is done and what remains.

## Engineering
- Prefer simple, readable, minimal changes aligned with existing patterns.
- Avoid new abstractions unless they reduce overall complexity.
- Review related files and cross‑reference existing logic before implementing.
- Reuse established system patterns when they already solve the problem.

## Validation
- Cross‑verify behavior against existing system logic and patterns.
