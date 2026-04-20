# Changelog Template

Use this structure for each dated changelog entry under `changelog/`.

## File naming

- Write to `changelog/{Month-DD-YYYY}.md`.
- Use the full English month name, two-digit day, and four-digit year.
- Example: `changelog/April-11-2026.md`.
- Keep one dated file per calendar day.
- Inside the dated file, keep one `## <branch> @ <short-head-sha> vs origin/staging` section per documented branch snapshot.
- If the same branch gets new commits later the same day, append a new section with the new short head SHA instead of renaming the earlier one.

## Required section order

Use this exact section order for each branch entry:

1. `## <branch> @ <short-head-sha> vs origin/staging`
2. `### Summary`
3. `### Branch Scope`
4. `### Key Changes`
5. `### Design Decisions`
6. `### Shared Contracts and Helpers to Reuse`
7. `### Removed or Replaced Items`
8. `### Future Branch Guardrails`
9. `### Validation Notes`

## Writing rules

- Keep every claim grounded in repository evidence.
- Reference repository paths inline.
- Name exported helpers, shared types, routes, hooks, schemas, services, or contracts explicitly.
- When code moved or was replaced, name both the old location and the canonical replacement.
- When a helper or contract should be reused later, say where it lives and why that location is
  now canonical.
- When something was removed, say not to reintroduce it and say what to use instead.
- If a category does not apply, write a short factual sentence instead of leaving it blank.
- Do not write generic roadmap or release language.

## Markdown skeleton

```md
# April-11-2026

## feat/example-branch @ abc1234 vs origin/staging

### Summary
- Explain the branch intent in 2-4 bullets.

### Branch Scope
- Compared `<merge-base>..<head>`.
- Note whether uncommitted local changes were included.
- List the main app/package areas touched.

### Key Changes
- Describe each important behavior change with file references.
- Group related files when they form one coherent change.

### Design Decisions
- Capture the reason for important structure, contract, or data-flow choices.
- Mention any intentional consolidation, split, rename, or ownership move.

### Shared Contracts and Helpers to Reuse
- Name new or updated reusable helpers/contracts and their canonical file paths.
- State how later branches should import, call, or extend them instead of creating parallel copies.

### Removed or Replaced Items
- List deleted, replaced, or folded code paths.
- Name the replacement path or state that no replacement should exist.

### Future Branch Guardrails
- List explicit reuse/do-not-reintroduce guidance for follow-on branches.
- Mention invariants, naming decisions, or file ownership rules that should stay consistent.

### Validation Notes
- Note the diff commands reviewed.
- Mention any tests, docs, or related files inspected to confirm the summary.
```
