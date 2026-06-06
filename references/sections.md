# Section examples

One realistic example for each required section. Copy-paste, edit the content, keep the structure. The examples sketch a hypothetical "enable Google OAuth on a Next.js + Supabase app" change — concrete enough to be useful, generic enough to adapt.

## TOC entry pattern

Every section gets a matching entry in **both** navs.

Inline TOC (`__TOC_LIST__`, mobile):
```html
<li><span>01</span><a href="#problem">Problem &amp; root cause</a></li>
```

Sidebar outline (`__OUTLINE_LINKS__`, desktop, scrollspy):
```html
<a href="#problem" data-href="problem"><span class="n">01</span><span>Problem &amp; root cause</span></a>
```

You can group outline entries with labels:
```html
<div class="group">Architecture</div>
<a href="#current" ...>...</a>
<a href="#target" ...>...</a>
```

## 01 Problem & root cause

```html
<section id="problem">
  <h2><span class="num">01</span> Problem &amp; root cause</h2>
  <p>Production currently returns:</p>
  <pre><code>{
  "code": 400,
  "error_code": "validation_failed",
  "msg": "Unsupported provider: provider is not enabled"
}</code></pre>
  <p>This response is emitted by Supabase Auth when the client calls <code>signInWithOAuth({ provider })</code> for a provider that is not toggled on in the project dashboard.</p>
  <div class="callout red"><strong>Why this happened.</strong> The UI was wired to four providers up front, but only the email provider was ever provisioned on Supabase.</div>
</section>
```

## 02 Scope & non-goals

```html
<section id="scope">
  <h2><span class="num">02</span> Scope &amp; non-goals</h2>
  <div class="grid cols-2">
    <div class="card">
      <h4>In scope</h4>
      <p>• Enable Google OAuth end-to-end.<br/>• Keep email/password working.<br/>• Remove Apple/Meta/X buttons.<br/>• Cypress e2e covering both flows.</p>
    </div>
    <div class="card">
      <h4>Out of scope</h4>
      <p>• Apple Sign-In.<br/>• Magic-link / phone auth.<br/>• Profile-completion screens.<br/>• Account merging across providers.</p>
    </div>
  </div>
</section>
```

## 03 Current architecture

```html
<section id="current">
  <h2><span class="num">03</span> Current architecture</h2>
  <p>Today the login page renders four social buttons, three of which are dead.</p>
  <div class="diagram">
    <pre class="mermaid">
flowchart LR
  U["User"] --> L["/auth/login (client)"]
  L --> G["Google btn"]
  L --> A["Apple btn"]
  L --> E["Email + password form"]
  G & A --> SDK["supabase.auth.signInWithOAuth(provider)"]
  SDK --> GoTrue["Supabase GoTrue"]
  GoTrue -->|"only email enabled"| Err400["400 validation_failed"]
    </pre>
  </div>
  <p class="cap">Current state — three buttons error because the provider was never enabled.</p>
</section>
```

## 04 Target architecture

Same shape as §03 but for the desired end state.

## 05+ Affected flows — sequence diagram

```html
<section id="oauth-flow">
  <h2><span class="num">06</span> Google OAuth flow</h2>
  <div class="diagram">
    <pre class="mermaid">
sequenceDiagram
  actor U as User
  participant App as app.example.com
  participant SB as Supabase GoTrue
  participant G as Google IdP
  U->>App: click "Sign in with Google"
  App->>SB: signInWithOAuth({provider:"google", ...})
  SB-->>App: { url: ".../authorize?provider=google" }
  App->>U: window.location = url
  U->>SB: GET /auth/v1/authorize
  SB->>U: 302 to accounts.google.com
  U->>G: consent
  G->>U: 302 to /auth/v1/callback?code=...
  U->>SB: GET /auth/v1/callback
  SB->>G: exchange code for tokens
  SB-->>U: set-cookie + 302 to app
    </pre>
  </div>
</section>
```

## Files to edit (table)

```html
<section id="files">
  <h2><span class="num">09</span> Files to edit</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>Path</th><th>Action</th><th>Why</th></tr></thead>
      <tbody>
        <tr>
          <td><code>app/auth/login/page.tsx</code></td>
          <td><span class="tag edit">edit</span></td>
          <td>Drop dead provider buttons; narrow OAuth type.</td>
        </tr>
        <tr>
          <td><code>cypress/e2e/auth-sign-in.cy.ts</code></td>
          <td><span class="tag new">new</span></td>
          <td>The e2e spec covering both flows.</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>
```

## Code changes (shape, not source)

```html
<section id="code-diffs">
  <h2><span class="num">10</span> Code changes (shape, not source)</h2>
  <p class="sub">Pseudocode of intent, not real source. Full source lives in the files during execution.</p>

  <h3>10.1 UI: four buttons → one</h3>
  <div class="diagram">
    <pre class="mermaid">
flowchart LR
  subgraph Before["Before"]
    G1["Google"] & A1["Apple"] & M1["Meta"] & X1["X"] --> EF1["Email form"]
  end
  subgraph After["After"]
    G2["Google"] --> EF2["Email form"]
  end
    </pre>
  </div>

  <h3>10.2 Per-file pseudocode</h3>
  <div class="scroll">
    <table>
      <thead><tr><th>File</th><th>Pseudocode change</th></tr></thead>
      <tbody>
        <tr>
          <td><code>app/auth/login/page.tsx</code></td>
          <td>
            <code>- remove AppleIcon, MetaIcon, XIcon</code><br/>
            <code>- socialButtons = [{ google }]</code> (was 4)<br/>
            <code>+ &lt;button data-testid="google-signin"&gt;</code>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</section>
```

## Third-party dashboard steps

```html
<section id="dashboard">
  <h2><span class="num">11</span> Supabase + Google dashboard steps</h2>

  <h3>11.1 What you (the human) need to bring</h3>
  <div class="scroll">
    <table>
      <thead><tr><th>Prerequisite</th><th>Why</th><th>How to confirm</th></tr></thead>
      <tbody>
        <tr><td>A Google account with project access</td><td>To create OAuth credentials</td><td>Sign in at console.cloud.google.com</td></tr>
        <tr><td><strong>Owner</strong> or <strong>Editor</strong> on the project</td><td>Required to edit consent screen</td><td>IAM &amp; Admin → IAM</td></tr>
        <tr><td>Domain verified in Search Console</td><td>Required to list as Authorized</td><td>search.google.com/search-console</td></tr>
      </tbody>
    </table>
  </div>

  <h3>11.2 Credential handoff — what crosses what boundary</h3>
  <div class="diagram">
    <pre class="mermaid">
flowchart LR
  subgraph GCP["Google Cloud (yours)"]
    Creds["OAuth Client ID + Secret"]
  end
  subgraph SB["Supabase"]
    Provider["Auth → Providers → Google"]
  end
  Creds -->|"paste once, by hand"| Provider
    </pre>
  </div>
  <p class="cap">The Client Secret lives only in Google Cloud and Supabase. It never reaches the app.</p>

  <h3>11.3 GCP — what you click</h3>
  <ol class="steps">
    <li><strong>OAuth consent screen</strong> → User Type: External, fill app info, add Authorized domain.</li>
    <li><strong>Credentials → OAuth client ID → Web application</strong>: set Authorized redirect URI to the Supabase callback URL.</li>
    <li>Copy Client ID + Client Secret.</li>
  </ol>
</section>
```

## Environment variables

```html
<section id="env">
  <h2><span class="num">12</span> Environment variables</h2>
  <p>No app-side env changes needed. Only test runner gets new vars:</p>
  <div class="scroll">
    <table>
      <thead><tr><th>Var</th><th>Where</th><th>Purpose</th></tr></thead>
      <tbody>
        <tr><td><code>CYPRESS_TEST_EMAIL</code></td><td>local .env.cypress</td><td>Pre-confirmed QA account</td></tr>
      </tbody>
    </table>
  </div>
</section>
```

## Test plan (pseudocode + strategy diagram)

```html
<section id="cypress">
  <h2><span class="num">13</span> Cypress e2e</h2>

  <h3>13.1 Strategy</h3>
  <p>One spec, three cases. Google can't complete consent under a headless browser — intercept the redirect and assert the 302 to accounts.google.com.</p>
  <div class="diagram">
    <pre class="mermaid">
flowchart TD
  C1["Case 1 — UI shape"] -->|assert| OK1["✓ only Google btn"]
  C2["Case 2 — Email/password"] -->|assert| OK2["✓ cookie set, on /"]
  C3["Case 3 — Google init"] -->|intercept /authorize| Auth{"302 to Google?"}
  Auth -->|yes| OK3["✓ provider enabled"]
  Auth -->|400| Fail["✗ bug present"]
    </pre>
  </div>

  <h3>13.2 Pseudocode</h3>
  <pre><code>spec("auth sign-in")
  case "only Google + email visible":
    visit /auth/login
    assert Google button visible
    assert no Apple/Meta/X buttons
  case "email/password signs in":
    visit /auth/login
    type email, password
    click submit
    assert pathname == "/"
    assert sb-* cookie exists
  case "Google init no 400":
    intercept GET /auth/v1/authorize as "auth"
      assert status in {302, 303}
      assert Location matches accounts.google.com
    visit /auth/login
    click Google button
    wait "@auth"</code></pre>
</section>
```

## Ask-gates

See SKILL.md "Ask-gates section format" — that section is the spec. Key reminders:
- Three-column table (Ask pattern / Risk if unattended / Fires at).
- Followed by a `<pre><code>[...]</code></pre>` with JUST the JSON array (merged into `permissions.ask`).
- Gate consequence, not activity: pushes, prod deploys, db mutations, money, secrets. Never tests/builds/read probes.
- More than ~8 entries means you're gating noise — cut it down.

## Rollout & verification

```html
<section id="rollout">
  <h2><span class="num">15</span> Rollout &amp; verification</h2>
  <ol class="steps">
    <li><strong>Phase 1 — UI cleanup.</strong> Apply §10 edits, commit, push.</li>
    <li><strong>Phase 2 — Dashboard.</strong> Follow §11.</li>
    <li><strong>Phase 3 — Cypress.</strong> Create QA user, run spec, attach video.</li>
  </ol>
  <h3>15.1 Acceptance checklist</h3>
  <ul class="checklist">
    <li>GET /auth/v1/settings shows <code>"google": true</code>.</li>
    <li>Email + password signs in to <code>/</code>.</li>
    <li>Cypress spec passes 3/3 against prod.</li>
  </ul>
</section>
```

## Risk & rollback

```html
<section id="risk">
  <h2><span class="num">16</span> Risk &amp; rollback</h2>
  <div class="grid cols-2">
    <div class="card">
      <h4>Risks</h4>
      <p>• Consent screen stuck in Testing.<br/>• Site URL misconfigured.</p>
    </div>
    <div class="card">
      <h4>Rollback</h4>
      <p>• Revert page edits — dead buttons return.<br/>• Toggle Google off in Supabase.</p>
    </div>
  </div>
</section>
```

## Agent runbook

```html
<section id="runbook">
  <h2><span class="num">17</span> Agent runbook</h2>
  <p class="sub">Read this before touching anything. Every step is a verification or a deterministic command.</p>

  <h3>17.1 Preflight — confirm state of the world</h3>
  <ol class="steps">
    <li><strong>Confirm repo + branch.</strong>
      <pre><code>pwd
git status -sb
git rev-parse HEAD</code></pre>
    </li>
    <li><strong>Source env.</strong>
      <pre><code>set -a; source .env.local; set +a
echo "URL=$NEXT_PUBLIC_SUPABASE_URL"</code></pre>
    </li>
    <li><strong>Probe state.</strong>
      <pre><code>curl -s -H "apikey: $KEY" "$URL/auth/v1/settings" | jq '.external'</code></pre>
      <strong>Decision tree.</strong>
      <ul class="clean">
        <li><code>external.google == true</code> → skip dashboard work.</li>
        <li><code>external.google == false</code> → stop; report to user.</li>
      </ul>
    </li>
  </ol>

  <h3>17.2 Execution order</h3>
  <div class="diagram">
    <pre class="mermaid">
flowchart TD
  P0["§17.1 preflight"] --> P1["Phase 1 — UI cleanup"]
  P1 --> V1{"e2e spec pass?"}
  V1 -->|yes| C1["commit + push"]
  C1 --> Q{"google enabled?"}
  Q -->|no| H["⏸ hand off to user"]
  H --> Q
  Q -->|yes| P2["Phase 2 — Cypress"]
    </pre>
  </div>

  <h3>17.3 Commands cheat-sheet</h3>
  <div class="scroll">
    <table>
      <thead><tr><th>Purpose</th><th>Command</th></tr></thead>
      <tbody>
        <tr><td>Cypress e2e (the only test gate)</td><td><code>npm run test:e2e</code></td></tr>
        <tr><td>Probe Supabase</td><td><code>curl -s -H "apikey: $KEY" "$URL/auth/v1/settings"</code></td></tr>
      </tbody>
    </table>
  </div>

  <h3>17.4 Definition of done</h3>
  <ul class="checklist">
    <li><code>git diff --stat main</code> touches only the files in §9.</li>
    <li>Probe shows <code>external.google: true</code>.</li>
    <li>Cypress 3/3 pass against prod (the only test gate).</li>
  </ul>

  <h3>17.5 Must-nots</h3>
  <ul class="clean">
    <li>Don't paste secrets anywhere outside the dashboard.</li>
    <li>Don't disable email confirmation to make tests easier.</li>
    <li>Don't commit <code>.env.local</code>.</li>
  </ul>
</section>
```

## Roadblocks & deviations (Phase 4 output)

This is the section appended AFTER execution:

```html
<section id="roadblocks">
  <h2><span class="num">18</span> Roadblocks &amp; deviations</h2>
  <p>One-sentence honest summary: shipped successfully with two doc patches. Two preflight commands needed adjustment; one third-party dashboard step had a different flow than documented.</p>

  <div class="diagram">
    <pre class="mermaid">
flowchart LR
  subgraph Planned
    P1["§11.3 step 2"] --> P2["..."]
  end
  subgraph Actual
    A1["§11.3 step 2 + Search Console verify"] --> A2["..."]
  end
  P1 -. "+30 min:<br/>domain not pre-verified" .-> A1
    </pre>
  </div>

  <div class="scroll">
    <table>
      <thead><tr><th>Planned</th><th>Actual</th><th>Why</th></tr></thead>
      <tbody>
        <tr>
          <td>Probe with <code>curl /auth/v1/settings</code></td>
          <td>Needed <code>apikey</code> header</td>
          <td>Endpoint now requires auth; old doc had stale call</td>
        </tr>
        <tr>
          <td>One file: <code>privacy/page.tsx</code></td>
          <td>Also <code>help/page.tsx</code>, <code>terms/page.tsx</code></td>
          <td>Missed in §9 — they reference the dropped providers too</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>18.1 Surprises worth recording</h3>
  <ul class="clean">
    <li>Google consent screen requires Search Console domain verification before Authorized domains accepts the entry.</li>
    <li>Supabase's settings endpoint requires <code>apikey</code> header even for public read.</li>
  </ul>

  <h3>18.2 Doc patches needed</h3>
  <ul class="clean">
    <li>§9: add <code>app/help/page.tsx</code>, <code>app/terms/page.tsx</code> rows.</li>
    <li>§11.1: add a Search Console pre-verification step.</li>
    <li>§17.3: update probe command to include <code>apikey</code> header.</li>
  </ul>
</section>
```

Don't forget to add §18 to both the inline TOC and the sidebar outline.
