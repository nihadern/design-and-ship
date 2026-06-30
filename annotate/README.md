# Annotate loop for design-and-ship

A small, self-contained tool that lets the user point at the generated HTML design
doc in a browser, click or select to leave annotations, and chat with the agent,
while the agent applies each annotation as an edit and replies in the side panel.
It runs between the "doc is ready" and "execute the change" phases of the
design-and-ship skill.

It is a from-scratch reimplementation of the Lavish review loop
(kunchenguid/lavish-axi, MIT). The annotation SDK in `public/sdk.js` is vendored and
adapted from Lavish's `artifact-sdk.js`; the server, side panel, CLI, and styling are
original and match design-and-ship's own branding (emerald accent, neutral surfaces,
14px radius, system sans, green brand dot). No em dashes anywhere, by project rule.

## How it works

1. The local loopback server serves the design doc inside a **sandboxed iframe**
   (`sandbox="allow-scripts allow-forms allow-popups allow-downloads"`, deliberately
   without `allow-same-origin`) with `public/sdk.js` injected just before `</body>`.
2. The injected SDK captures element clicks and text selections, builds a CSS selector
   (walking up to 5 ancestors), and shows an annotation card in a shadow DOM. It posts
   each annotation to the side panel over `postMessage`.
3. The side panel (`public/chrome-client.js` + `public/chrome.css`) queues annotations,
   POSTs them to the server, renders the conversation, and listens on an SSE stream for
   live-reload events and agent replies.
4. The agent runs a **blocking** `poll <file>` that long-polls the server and prints the
   queued annotations as JSON on stdout.
5. The agent edits the doc file; a `fs.watch` watcher pushes an SSE `reload`, and the
   iframe live-updates.
6. `poll <file> --agent-reply "..."` posts a chat reply that shows up in the side panel.

The server binds to `127.0.0.1` only, defaults to port **4388**
(`DNS_ANNOTATE_PORT` to override), and shuts itself down after ~30 minutes idle
(`DNS_ANNOTATE_IDLE_MS`, or `off` to disable). State lives in
`~/.dns-annotate/state.json` (`DNS_ANNOTATE_STATE_DIR` to override). Zero runtime
dependencies: Node's built-in `http` and `fs.watch` do the work, so there is no
install step.

## CLI

```sh
# open the doc for review (spawns the detached server if needed, prints the URL, xdg-opens it)
node annotate/cli.js open docs/my-design-doc.html
node annotate/cli.js open docs/my-design-doc.html --no-open   # print URL, do not launch a browser

# block until the user annotates or sends a chat message; prints JSON to stdout
node annotate/cli.js poll docs/my-design-doc.html

# same, but first push a chat reply into the side panel
node annotate/cli.js poll docs/my-design-doc.html --agent-reply "Got it, updating now"

# non-streaming variant for scripts/tests (returns immediately after the timeout)
node annotate/cli.js poll docs/my-design-doc.html --timeout-ms 2000

# end the review session
node annotate/cli.js end docs/my-design-doc.html

# stop the server entirely
node annotate/cli.js stop
```

`poll` writes the final JSON to **stdout** and all status/heartbeat lines to **stderr**,
so stdout stays parseable. Each annotation in the JSON carries `prompt` (what the user
typed), `selector` (the CSS selector of the target), `tag`, `text` (the element's text),
and for text selections a `target` range with start/end anchors.

## Files

| File | Role |
|------|------|
| `cli.js` | open / poll / end / stop commands and the long-poll client |
| `server.js` | loopback http server, routes, sandboxed iframe serving, fs.watch live reload, SSE, blocking long-poll |
| `store.js` | JSON session store keyed by a hash of the canonical doc path |
| `public/sdk.js` | vendored + adapted annotation SDK (click/text-select capture, selector building, shadow-DOM card, postMessage) |
| `public/chrome-client.js` | side panel browser logic (queue, submit, chat, SSE, live reload) |
| `public/chrome.css` | side panel styling matching design-and-ship branding |
