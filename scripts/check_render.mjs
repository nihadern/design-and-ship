/**
 * check_render.mjs — render a design doc in a real (headless) browser and verify
 * every Mermaid diagram actually parses. The doc's own loader swallows Mermaid
 * errors (try/catch noop) and Mermaid draws a "Syntax error in text" graphic in
 * place, so a broken diagram ships silently unless something drives the page and
 * inspects it. This does exactly that.
 *
 *   node check_render.mjs <path-to-design-doc.html>
 *
 * Exit 0 = all diagrams parse; 1 = at least one failed (prints the block index,
 * the diagram's first line, and Mermaid's exact error); 2 = bad usage.
 *
 * Pinned to playwright@1.60.0 to reuse the cached chromium-1223 (no download).
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = process.argv[2];
if (!arg) { console.error('usage: node check_render.mjs <design-doc.html>'); process.exit(2); }
const file = resolve(arg);
if (!existsSync(file)) { console.error('not found: ' + file); process.exit(2); }
const url = pathToFileURL(file).href;

let browser;
let bad = 0;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  // Give the doc's own mermaid.run() time to finish (CDN import + render).
  await page.waitForTimeout(3500);

  // Re-parse each block's stored source with a fresh Mermaid for an exact error.
  const results = await page.evaluate(async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    const els = [...document.querySelectorAll('.mermaid')];
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const src = (els[i].dataset.src || els[i].textContent || '').trim();
      const head = src.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2).join(' / ');
      let ok = true, error = null;
      try { await mermaid.parse(src); } catch (e) { ok = false; error = String(e && e.message ? e.message : e); }
      const domError = /syntax error/i.test(els[i].textContent || '');
      out.push({ i, head, ok, error, domError });
    }
    return out;
  });

  console.log(`Checked ${results.length} Mermaid diagram(s) in ${file}\n`);
  for (const r of results) {
    if (r.ok && !r.domError) {
      console.log(`  ✅ #${r.i}  ${r.head}`);
    } else {
      bad++;
      console.log(`  ❌ #${r.i}  ${r.head}`);
      if (r.error) console.log(`       ${r.error.replace(/\n/g, '\n       ')}`);
      else if (r.domError) console.log('       rendered a "Syntax error" graphic (no parse message)');
    }
  }
  if (consoleErrors.length) {
    console.log('\nConsole errors:');
    for (const e of consoleErrors.slice(0, 10)) console.log('  ! ' + e);
  }
  console.log('');
  if (bad) console.log(`❌ ${bad} diagram(s) failed to parse`);
  else console.log('✅ all diagrams parse');
} catch (e) {
  console.error('check_render error:', e && e.message ? e.message : String(e));
  bad = 1;
} finally {
  if (browser) await browser.close();
}
process.exit(bad ? 1 : 0);
