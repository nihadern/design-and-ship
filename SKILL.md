---
name: design-and-ship
description: Author a rich, mobile-responsive HTML design doc for a code change, get the user's sign-off, apply the permissions the doc says you'll need, isolate the work in a git worktree, execute the change step by step against the doc, then append a "Roadblocks & deviations" recap to the same HTML file. Trigger on requests for a design doc, technical spec, RFC, implementation plan, architecture sketch, or runbook before shipping a non-trivial change — even when the user doesn't say "design doc" but says things like "plan this", "spec it out", "write up how we'd do X", "design a doc for X then ship it", "make a plan with diagrams", or asks for a doc with architecture diagrams, an agent runbook, or a Cypress test plan. Also use whenever a task is large enough that the user would benefit from sign-off before code starts and a recap after it lands.
---

# Design and Ship

A three-phase workflow for non-trivial changes:

1. **Design** — author a self-contained HTML design doc with diagrams, pseudocode (not full source), the permissions you'll need, and an agent runbook
2. **Ship** — after user sign-off, merge the permissions into `~/.claude/settings.json`, enter a git worktree, execute the doc
3. **Recap** — append a "Roadblocks & deviations" section to the same doc, recording what actually happened

The reason for this shape: design docs that go stale during implementation are worse than no doc. By writing the recap into the same file, the doc stays accurate, the user gets a paper trail of decisions, and future work has a starting reference that matches reality.

---

## Phase 1 — Design

### Where the file lives

- Output path: `docs/<topic>-design-doc.html` inside the project repo (not the home folder, not `/tmp`)
- If the repo has no `docs/` directory, create one. Don't dump the file at the repo root
- Filename uses kebab-case and ends with `-design-doc.html` so it's grep-able

### Starting from the template

Read `assets/template.html` from this skill. It already contains the full CSS, the sticky-header, the layout grid, the sidebar `<aside class="outline">`, the inline `<nav class="toc">`, the Mermaid loader, the theme toggle, and the scrollspy. **Do not rewrite the CSS or scripts.** Replace only the marked placeholders:

- `__TITLE__` — page title (e.g., `Acme — Auth Design Doc`)
- `__SUBTITLE__` — short tagline (e.g., "Google OAuth + Email/Password")
- `__BRAND_LABEL__` — short label after the brand dot (e.g., "Auth Design")
- `__LEDE__` — one paragraph for the hero
- `__PILLS__` — `<span class="pill ...">…</span>` chips
- `__TOC_LIST__` — `<li>` entries for the inline TOC (mobile)
- `__OUTLINE_LINKS__` — `<a data-href="…">` entries for the sidebar (desktop)
- `__SECTIONS__` — the actual numbered sections
- `__THEME_STORAGE_KEY__` — distinct localStorage key (`dq-<topic>-theme`)
- `__FOOTER_NOTE__` — one-line footer

### Required sections (in this exact order)

Use the numbered `<span class="num">XX</span>` style for every section heading. Numbers run consecutively starting at 01.

| # | Heading | Must contain |
|---|---|---|
| 01 | Problem & root cause | Exact error string if there is one; one-paragraph root cause |
| 02 | Scope & non-goals | Two-column `.grid.cols-2` cards |
| 03 | Current architecture | One Mermaid `flowchart` of how things work today |
| 04 | Target architecture | One Mermaid `flowchart` of the desired state |
| 05+ | Affected flows | One `sequenceDiagram` per flow that materially changes |
| — | Files to edit | A table with columns: path / action tag / why |
| — | Code changes (shape, not source) | Before/after Mermaid + a per-file pseudocode table |
| — | Third-party dashboard steps | Only if external services (Google Cloud, Stripe, Supabase, etc.) need configuration |
| — | Environment variables | Table; only the vars that change |
| — | Test plan | Strategy Mermaid + pseudocode of test cases (NOT full source) |
| — | Claude permissions to add | Table + paste-ready JSON snippet for `permissions.allow` |
| — | Rollout & verification | Phased; acceptance checklist as `<ul class="checklist">` |
| — | Risk & rollback | Two-column `.grid.cols-2` cards |
| Last | Agent runbook | Preflight commands, ordered execution Mermaid, commands cheat-sheet table, definition-of-done `<ul class="checklist">`, must-nots list |

See `references/sections.md` for concrete examples of each.

### The pseudocode rule

Show the **shape** of the change, never paste full files. The doc is for orientation, not source-of-truth code. Use a sketch syntax that conveys intent:

```
- remove AppleIcon, MetaIcon, XIcon
- socialButtons = [{ google }]   (was 4 entries)
- handleOAuth(provider: "google")
+ <button data-testid="google-signin">
```

If you find yourself pasting more than ~10 lines of real source into a `<pre>`, stop and refactor it into pseudocode. Full source goes into the actual files during Phase 2, not the doc.

### Diagram conventions

- Mermaid 11. Always wrap in `<div class="diagram"><pre class="mermaid">…</pre></div>` and follow with `<p class="cap">caption</p>`
- Pick the right shape: `flowchart TB|TD|LR` for systems, `sequenceDiagram` for actor flows, `erDiagram` for data
- Mermaid is initialized once with `useMaxWidth: true` already — don't override
- Diagrams must render in both light and dark themes — the script in the template re-renders on toggle. Don't hard-code colors inside diagrams
- Use plain ASCII in diagram labels. Smart quotes and other Unicode quirks can break the Mermaid parser

### Pre-flight checks before saving

Before you tell the user the doc is ready:

1. **Tag balance.** Run a quick parser pass — every `<section>`, `<pre>`, `<table>`, `<div>`, `<aside>`, `<main>`, `<nav>`, `<script>`, `<style>` must match. Use the snippet in §"Tag balance check" below.
2. **Sidebar ↔ sections 1:1.** Count `<a data-href="…">` entries in the sidebar and `<section id="…">` in main. Same count. Same IDs.
3. **Every claim is verified.** Any file path, line number, API endpoint, env var name, error string, or version cited in the doc must be confirmed against the actual repo / live service before the doc lands — not pulled from memory. Use grep, read, curl. When something can't be verified, mark it as `(verify before relying)` rather than asserting it.
4. **No long source blocks.** If a `<pre>` is over 20 lines and isn't a permissions JSON snippet or a shell preflight command block, it's probably real source — re-cast as pseudocode.

#### Tag balance check

```python
import re
src = open(path).read()
for tag in ['section','aside','main','div','nav','pre','table','script','style']:
    o = len(re.findall(r'<'+tag+r'\b', src))
    c = len(re.findall(r'</'+tag+r'>', src))
    if o != c: print(f'WARN {tag} open={o} close={c}')
```

### Permissions section format

This section is doing real work — it's both the user's audit trail and the literal payload Phase 2 will merge into `~/.claude/settings.json`. Get this right and the user clicks "approve" once at sign-off; get it wrong and they have to keep hitting "yes" mid-execution.

#### The principle

**Least privilege, but comprehensive.** Every Bash command, WebFetch URL, MCP tool, or Skill invocation the runbook (§17) is going to fire must appear in the list — narrowly scoped — so execution flows without confirmation prompts. List too little and you'll interrupt the user for every blocked tool call. List too much and the user can't reasonably audit what they're authorizing.

#### What is ALREADY allowed by default — never list these

These tools are part of the base Claude Code permission set. Listing them is noise that distracts the user from what they're actually authorizing:

- `Edit`, `Write`, `Read`, `Glob`, `Grep`, `NotebookEdit`
- `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskStop`, `TaskOutput`, `Monitor`
- `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `ExitWorktree`
- `AskUserQuestion`, `ScheduleWakeup`
- The bare `Bash` tool (without a pattern) — note: bare `Bash` is NOT default-allowed; what's default-allowed is the user already having a permission mode set. If the user is in "accept edits" mode for example, Read/Edit/Write don't need authorization. Don't list them regardless.

**Rule of thumb:** if it's a generic file-system tool, don't list it. List only the specific external commands, URL fetches, and MCP tool calls the runbook will trigger.

#### What MUST be listed

Walk §17.1 (preflight), §17.3 (commands cheat-sheet), and any embedded commands in §10/§13. For each:

- **Every `Bash(…)` pattern.** Be specific: `Bash(npm run test:*)` over `Bash(npm run *)`; `Bash(npx cypress run:*)` over `Bash(npx *)`. The `*` is a glob — pick the smallest pattern that covers the runbook's commands.
- **Every WebFetch domain.** Format `WebFetch(domain:console.cloud.google.com)`. List the actual hostnames the runbook fetches.
- **Every MCP tool the runbook calls.** Format `mcp__<server>__<tool>` if known; otherwise leave a placeholder and flag for the user.
- **Every Skill invocation** that isn't this one (`Skill(skill-name)`).
- **Specific URL probes** that aren't general WebFetch — e.g., `Bash(curl -s https://*.supabase.co/auth/v1/settings*)` when the runbook curls a known endpoint.

#### Auditing comprehensively (do this before signing off)

Re-read §17 with a grep mindset. For every backticked command, ask: "is the pattern for this already in the permissions list?" If not, add it. This is the single highest-leverage check for keeping the user out of the confirmation loop.

A useful pass: copy every command from §17.1 and §17.3 into a scratch list. For each, write the minimum pattern that matches. Sort, dedupe, that's your `permissions.allow` array.

#### HTML format

```html
<section id="permissions">
  <h2><span class="num">14</span> Claude permissions to add</h2>
  <p>The work in this doc needs these capabilities. <code>Edit</code>, <code>Read</code>, <code>Write</code>, <code>Glob</code>, <code>Grep</code>, and task tools are already allowed — only Bash patterns, WebFetch domains, and MCP tools are listed below. Paste-ready snippet for <code>~/.claude/settings.json → permissions.allow</code>:</p>
  <div class="scroll">
    <table>
      <thead><tr><th>Permission</th><th>Why</th><th>Fires at</th></tr></thead>
      <tbody>
        <tr>
          <td><code>Bash(npm run test:*)</code></td>
          <td>Run the new unit + e2e suites</td>
          <td>§17.3, §17.4</td>
        </tr>
        ...
      </tbody>
    </table>
  </div>
  <pre><code>[
  "Bash(npm run test:*)",
  "Bash(curl -s https://...)",
  "WebFetch(domain:example.com)"
]</code></pre>
</section>
```

The third column ("Fires at") maps each permission to the runbook step that needs it — that's how you prove the audit is complete. The JSON inside `<pre><code>` is what Phase 2 parses; keep it as a valid JSON array with no comments.

### Agent runbook section format

This is the most important section. It's the part that lets a fresh agent execute the doc with no other context. Include all five subsections:

- **17.1 Preflight** — exact shell commands that verify state-of-the-world (read env, probe live services, confirm file paths exist, grep for hidden dependencies). Each command should print the decision-relevant output.
- **17.2 Execution order** — a Mermaid `flowchart TD` showing the phases, with explicit hand-off points where the user has to act in a third-party UI.
- **17.3 Commands cheat-sheet** — a table mapping intent → exact command (use the repo's real `npm run …` scripts, not invented ones).
- **17.4 Definition of done** — a `<ul class="checklist">` of objective checks (lint pass, test pass, grep returns empty, etc.). Each item must be verifiable, not opinion-based.
- **17.5 Must-nots** — five-ish concrete things the agent should not do even if they'd be expedient (e.g., "don't commit `.env.local`", "don't disable email confirmation to make tests easier"). These come from anticipating shortcuts that would compromise the change.

---

## Phase 2 — Approve & apply permissions

When the user approves the doc, apply the permissions in a single deterministic step. Don't ask the user to paste anything — the script below reads the JSON array directly out of the design doc you just wrote, so there's no copy-paste error path.

### The merge

`jq` cannot dedupe arrays without `--slurp` gymnastics, so use Python. This one command reads the doc, finds the permissions section, parses the JSON, and merges into `~/.claude/settings.json` — preserving all other keys (hooks, env, theme, enabledPlugins, etc.). Substitute `DOC_PATH` for the actual design doc path you wrote in Phase 1:

```bash
python3 - <<'PY'
import json, pathlib, re, sys

DOC_PATH = "docs/<topic>-design-doc.html"   # <-- replace with the actual path
SETTINGS = pathlib.Path.home() / ".claude/settings.json"

doc = pathlib.Path(DOC_PATH).read_text()
# Find the permissions section and pull the first JSON array out of its <pre><code>...</code></pre>
m = re.search(
    r'<section id="permissions">[\s\S]*?<pre><code>(\[[\s\S]*?\])</code></pre>',
    doc,
)
if not m:
    sys.exit("ERROR: no <pre><code>[...]</code></pre> JSON array found inside <section id=\"permissions\">")
try:
    new = json.loads(m.group(1))
except json.JSONDecodeError as e:
    sys.exit(f"ERROR: permissions block is not valid JSON: {e}")
if not isinstance(new, list) or not all(isinstance(x, str) for x in new):
    sys.exit("ERROR: permissions block must be a flat array of strings")

cfg = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}
allow = cfg.setdefault("permissions", {}).setdefault("allow", [])
before = set(allow)
added = [x for x in new if x not in before]
allow.extend(added)
SETTINGS.write_text(json.dumps(cfg, indent=2) + "\n")

print(f"Settings: {SETTINGS}")
print(f"Added ({len(added)}):")
for x in added: print("  +", x)
skipped = [x for x in new if x in before]
if skipped:
    print(f"Already present ({len(skipped)}):")
    for x in skipped: print("  =", x)
PY
```

### Verifying the merge took effect

After the merge, the user is NOT prompted for any new tool call whose pattern is now in the list — but the agent should still sanity-check by:

1. Reading `~/.claude/settings.json` back and confirming every entry from the doc is present in `permissions.allow`.
2. Running one of the granted commands as a smoke test (e.g., the §17.1 preflight probe). If that command still triggers a confirmation prompt, the pattern is wrong — narrow or broaden it and re-merge.

### Safety rules

- Never edit `permissions.allow` outside of this script — manual edits drift from what the doc says, and the recap in Phase 4 won't be honest.
- Never apply permissions before the user approves the doc. The doc is the audit artifact; running this step is the consent signal.
- Never use `permissions.deny` or `permissions.ask` from this skill — those are user-managed.
- Do not list `Edit`, `Read`, `Write`, `Glob`, `Grep`, or generic `Bash` in the array. They're either already allowed or so broad that listing them defeats audit.

---

## Phase 3 — Worktree + execute

1. **EnterWorktree.** Unless the doc itself opts out (some changes legitimately belong on the main checkout — surface this to the user before deciding). The worktree isolates uncommitted state so a failed execution can be discarded by abandoning the worktree.
2. **Mirror the runbook into a task list.** Use TaskCreate so progress is visible in the UI; the runbook's "Execution order" diagram is the source. Mark each task in_progress when starting, completed when done.
3. **Execute step by step.** Run each preflight command; act on the output. Don't batch decisions ahead — the doc anticipates branches (e.g., "if external.google is true, skip §11") and you should follow them.
4. **Keep a deviation log.** Maintain a running scratch list as you go. Every time something diverges from the doc, append an entry. Examples of what counts:
   - A file you had to touch that wasn't in the §9 table
   - A command in the doc that didn't work as written and what you ran instead
   - A third-party dashboard step where the UI flow differed from the doc
   - An assumption in the doc that turned out to be wrong (file moved, env var renamed, version drift)
   - A blocker that pushed work to a follow-up

Keep the log in a scratch file at `$CLAUDE_JOB_DIR/deviations.md` (or in memory if no jobs dir) so it survives a compact. Format each entry as:

```
## <what>
- planned: <what the doc said>
- actual: <what happened>
- why: <root cause / surprise>
- impact: <kept going / fixed in flight / deferred to follow-up>
```

### When to stop and hand back

Stop and ask the user before continuing if:

- The deviation is bigger than the doc's scope (would require revisiting Phase 1)
- A third-party dashboard step requires their account / consent
- A permission you need isn't in the approved snippet — never silently grant yourself more
- A "must-not" from §17.5 would be violated by the path forward

---

## Phase 4 — Append "Roadblocks & deviations"

When execution ends (success, partial, or stopped), append a new section to the same HTML doc. It's the source of truth for what *actually* happened.

### Section content

- **Numbered** as the next in sequence (e.g., if the runbook was §17, this is §18)
- **Title:** `Roadblocks & deviations`
- One opening paragraph: honest one-sentence summary of how it went (success / partial / blocked) and the headline reason
- A small Mermaid `flowchart LR` of **planned vs actual** if the path diverged meaningfully — left side is the doc's flow, right side is what actually happened, with arrows linking the diverge points
- A `<table>` with three columns: **Planned** / **Actual** / **Why** — one row per deviation log entry
- A `<ul class="clean">` of surprises worth recording for next time (things that didn't break the change but would have been useful in the doc up front)
- A short "doc patches" subsection listing fixes the doc itself needs — these are the corrections the next person reading the doc will benefit from

### Sidebar + TOC updates

Add the matching entry to **both** the inline `<nav class="toc">` and the sticky `<aside class="outline">`:

- TOC: `<li><span>18</span><a href="#roadblocks">Roadblocks & deviations</a></li>`
- Outline: `<a href="#roadblocks" data-href="roadblocks"><span class="n">18</span><span>Roadblocks &amp; deviations</span></a>`

### Re-balance before saving

Run the tag balance check again. Append-only edits to an HTML file have a way of breaking sidebar ↔ section parity. Confirm:

- Section count == sidebar entry count == TOC entry count
- The new section ID is unique
- No `<hr class="divide" />` was dropped between sections
- Mermaid block count increased by exactly 0 or 1

---

## Naming and tone

- The doc speaks plainly. No marketing voice. State what something is, why it matters, and what changes.
- Headings use sentence case (`Files to edit`, not `Files To Edit`).
- Tables prefer short cells. If a cell is a paragraph, lift it into prose under the table.
- Code/identifiers always in `<code>`. File paths too.
- Use Mermaid for any flow with more than two arrows. Use ASCII or prose for two-step things — diagrams have overhead.
- One Mermaid block per concept. Don't cram four ideas into one diagram.

## What this skill does NOT do

- Does not write the design doc autonomously without first scanning the codebase. Every claim is grounded.
- Does not apply permissions to `settings.json` before the user approves the doc.
- Does not skip the worktree.
- Does not silently expand scope mid-execution.
- Does not consider the work done until the recap section is in place.

## Pointer: section examples

See `references/sections.md` for one realistic example of each required section, copy-pasteable as a starting point.
