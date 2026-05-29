# design-and-ship

A Claude Code skill for shipping non-trivial changes with a real paper trail.

Most changes go: think a bit → write code → commit. This is fine for small stuff but falls apart at scale: there's no artifact to align on before code lands, no record of what got skipped, no honest log of what surprised you. `design-and-ship` adds two bookends:

1. A **rich HTML design doc** before code starts (architecture diagrams, pseudocode, runbook).
2. A **"Roadblocks & deviations"** section appended after code lands, recording what actually happened.

The same file holds both. The doc never goes stale.

## What the skill does

Four phases, executed by Claude when the skill triggers:

| Phase | What happens |
|---|---|
| 1. Design | Generates a self-contained, mobile-responsive HTML doc with Mermaid diagrams, a per-file pseudocode table, a permissions list, and an agent runbook. |
| 2. Approve + apply | After user sign-off, merges the permissions array from the doc directly into `~/.claude/settings.json`. |
| 3. Worktree + execute | Calls `EnterWorktree` to isolate, then walks the runbook step by step. Keeps a deviation log as it goes. |
| 4. Recap | Appends a "Roadblocks & deviations" section to the same HTML file (planned vs actual, surprises, doc patches). |

The doc has a sticky sidebar TOC, light/dark theme with localStorage, scrollspy, and is readable on mobile. See `assets/template.html` for the shell.

## Install

Clone into your user-level Claude skills directory:

```bash
git clone https://github.com/nihadern/design-and-ship.git ~/.claude/skills/design-and-ship
```

Claude Code picks up skills under `~/.claude/skills/` automatically. The skill triggers on phrases like *"design a doc for X"*, *"plan this and ship it"*, *"write up how we'd do X"*, *"make a spec with diagrams"*, etc.

## Triggers

Use whenever a change is large enough to warrant sign-off before code starts and a recap after it lands. Concretely:

- "design a doc for X then ship it"
- "spec out the auth fix"
- "write an implementation plan with diagrams"
- "RFC for the migration"
- "I want a runbook for this"

## File layout

```
design-and-ship/
├── SKILL.md                  # The four-phase playbook Claude follows
├── assets/
│   └── template.html         # Styled HTML shell with placeholders
└── references/
    └── sections.md           # Copy-paste examples for each required section
```

## Conventions the skill enforces

- **Pseudocode, not source.** The doc shows the *shape* of the change. Real source goes in the files during execution.
- **One Mermaid block per concept.** Diagrams render in light and dark themes; no hard-coded colors.
- **Verified claims only.** Every file path, line number, env var, and API endpoint cited in the doc must be confirmed against the actual repo or live service before the doc lands.
- **Least-privilege permissions, but comprehensive.** Default-allowed tools (`Edit`, `Read`, `Write`, `Glob`, `Grep`, etc.) are never listed. Every `Bash` / `WebFetch` / MCP call the runbook will fire is listed with a narrow pattern so execution doesn't trigger confirmation prompts.
- **Honest recap.** Phase 4 records what didn't work, what changed, and what patches the doc itself needs for next time.

## Required sections in the generated doc

Numbered consecutively starting at 01:

1. Problem & root cause
2. Scope & non-goals
3. Current architecture (flowchart)
4. Target architecture (flowchart)
5. Affected flows (sequence diagrams)
6. Files to edit (table)
7. Code changes (shape, not source)
8. Third-party dashboard steps (if external services are involved)
9. Environment variables
10. Test plan (strategy diagram + pseudocode)
11. Claude permissions to add
12. Rollout & verification
13. Risk & rollback
14. Agent runbook (preflight commands, ordered execution diagram, commands cheat-sheet, definition-of-done, must-nots)

Then after execution, appended in Phase 4:

15. Roadblocks & deviations

## License

MIT.
