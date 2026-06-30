# design-and-ship

A Claude Code skill for shipping non-trivial changes with a real paper trail.

Most changes go: think a bit → write code → commit. This is fine for small stuff but falls apart at scale: there's no artifact to align on before code lands, no record of what got skipped, no honest log of what surprised you. `design-and-ship` adds two bookends:

1. A **rich HTML design doc** before code starts (architecture diagrams, pseudocode, runbook).
2. A **"Roadblocks & deviations"** section appended after code lands, recording what actually happened.

The same file holds both. The doc never goes stale.

## What the skill does

Phases executed by Claude when the skill triggers:

| Phase | What happens |
|---|---|
| 1. Design | Generates a self-contained, mobile-responsive HTML doc with Mermaid diagrams, a per-file pseudocode table, a predicted list of ask-gates (commands risky enough to confirm before running), and an agent runbook. |
| 1.5 Annotate | Opens the doc in the browser annotate loop. The user clicks elements or selects text to leave annotations and chats in a side panel; Claude applies each annotation as an edit, replies to confirm, and loops until the user ends the session. Runs before sign-off. |
| 2. Approve + apply | After user sign-off, merges the ask-gates array from the doc directly into `~/.claude/settings.json → permissions.ask`. |
| 3. Worktree + execute | Calls `EnterWorktree` to isolate, then walks the runbook step by step. Keeps a deviation log as it goes. |
| 4. Recap | Appends a "Roadblocks & deviations" section to the same HTML file (planned vs actual, surprises, doc patches). |

The doc has a sticky sidebar TOC, light/dark theme with localStorage, scrollspy, and is readable on mobile. See `assets/template.html` for the shell.

## The annotate loop

`annotate/` is a self-contained, zero-dependency tool (Node built-in `http` + `fs.watch`) that lets the user review the generated doc visually and steer edits in real time. It is a from-scratch reimplementation of the Lavish review loop (kunchenguid/lavish-axi, MIT): the annotation SDK in `annotate/public/sdk.js` is vendored and adapted from Lavish, while the server, side panel, CLI, and styling are original and match this project's branding.

How it works: a loopback server serves the doc inside a sandboxed iframe (`allow-scripts allow-forms allow-popups allow-downloads`, deliberately without `allow-same-origin`) with the SDK injected before `</body>`. The SDK captures element clicks and text selections, builds a CSS selector (up to 5 ancestors), and shows an annotation card in a shadow DOM. Annotations flow over `postMessage` to a side panel, which POSTs them to the server. Claude runs a blocking `poll` that long-polls and returns the annotations as JSON; Claude edits the doc, an `fs.watch` watcher pushes an SSE reload so the iframe live-updates, and `poll --agent-reply "..."` posts a chat reply back to the browser.

```bash
node annotate/cli.js open <doc.html>                       # serve + open in browser
node annotate/cli.js poll <doc.html>                       # block until annotations arrive (JSON on stdout)
node annotate/cli.js poll <doc.html> --agent-reply "text"  # push a chat reply, then poll
node annotate/cli.js end <doc.html>                         # end the review session
node annotate/cli.js stop                                   # shut the server down
```

Loopback only, default port 4388 (`DNS_ANNOTATE_PORT` to override), idle self-shutdown after ~30 minutes. See `annotate/README.md` for details.

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
├── SKILL.md                  # The phased playbook Claude follows
├── assets/
│   └── template.html         # Styled HTML shell with placeholders
├── annotate/                 # Browser annotate loop (zero deps; SDK vendored from Lavish)
│   ├── cli.js                # open / poll / end / stop commands
│   ├── server.js             # loopback server, sandboxed iframe, fs.watch live reload, SSE
│   ├── store.js              # JSON session store keyed by the canonical doc path
│   ├── public/               # sdk.js (injected), chrome-client.js, chrome.css
│   └── README.md
└── references/
    └── sections.md           # Copy-paste examples for each required section
```

## Conventions the skill enforces

- **Pseudocode, not source.** The doc shows the *shape* of the change. Real source goes in the files during execution.
- **One Mermaid block per concept.** Diagrams render in light and dark themes; no hard-coded colors.
- **Verified claims only.** Every file path, line number, env var, and API endpoint cited in the doc must be confirmed against the actual repo or live service before the doc lands.
- **Gate consequence, not activity.** Built for auto mode: routine commands (tests, builds, read probes) run without prompts. The doc predicts the few commands that genuinely deserve a human pause — pushes, prod deploys, db mutations, money, secrets — and gates exactly those via `permissions.ask`, each with a narrow pattern and a stated risk.
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
10. Test plan — **end-to-end only by default** (Cypress / Playwright); strategy diagram + pseudocode. Unit and integration plans are added only when the user explicitly asks.
11. Commands that will ask first (merged into `permissions.ask`)
12. Rollout & verification
13. Risk & rollback
14. Agent runbook (preflight commands, ordered execution diagram, commands cheat-sheet, definition-of-done, must-nots)

Then after execution, appended in Phase 4:

15. Roadblocks & deviations

## License

MIT.
