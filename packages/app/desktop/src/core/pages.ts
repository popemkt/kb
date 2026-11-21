/**
 * The desktop's own two pages: the quick-capture panel and the store list.
 * Each is one self-contained document served by the control server
 * (`control.ts`) and talks to it alone, with the session's token in a
 * header, so any shell's webview can load them. They are the app's chrome,
 * not kb's page, which every store window loads from its own host.
 */

import { CAPTURE_PAIR_CODE } from "@kb/contracts";

const BASE_STYLE = `
:root { color-scheme: light dark; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid GrayText; background: ButtonFace; color: ButtonText; cursor: pointer; }
input, textarea, select { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid GrayText; background: Field; color: FieldText; box-sizing: border-box; }
.muted { opacity: 0.65; }
.error { color: #d33; }
`;

/** The shared script: `api(path, body?)` calls the control server with the token. */
function apiScript(token: string): string {
  return `
const TOKEN = ${JSON.stringify(token)};
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-kb-desktop": TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: "HTTP " + res.status }));
  if (!res.ok || json.error) throw new Error(json.error || ("HTTP " + res.status));
  return json;
}`;
}

/** The quick-capture panel: one field, the store it goes to, Enter sends, Escape closes. */
export function capturePage(token: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Quick capture</title>
<style>${BASE_STYLE}
body { padding: 12px; display: flex; flex-direction: column; gap: 8px; height: 100vh; box-sizing: border-box; }
header { display: flex; justify-content: space-between; font-size: 12px; }
textarea { flex: 1; resize: none; font-size: 16px; }
#status { font-size: 12px; min-height: 1.2em; }
</style></head>
<body>
<header><span>Capture to <strong id="target">…</strong></span><span class="muted">Enter saves · Shift+Enter new line · Esc closes</span></header>
<textarea id="text" autofocus placeholder="A thought, a link…"></textarea>
<div id="status"></div>
<script>${apiScript(token)}
const field = document.getElementById("text");
const status = document.getElementById("status");
let sending = false;
api("/api/capture/target").then((t) => { document.getElementById("target").textContent = t.name; })
  .catch((e) => { status.textContent = e.message; status.className = "error"; });
field.focus();
window.addEventListener("focus", () => field.focus());
field.addEventListener("keydown", async (event) => {
  if (event.key === "Escape") { event.preventDefault(); await api("/api/capture/close", {}); return; }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || sending) return;
  event.preventDefault();
  const text = field.value;
  if (text.trim() === "") return;
  sending = true; status.textContent = "Saving…"; status.className = "muted";
  try {
    await api("/api/capture", { text });
    field.value = "";
    status.textContent = "";
  } catch (e) {
    // The text stays in the field, so nothing typed is lost.
    status.textContent = e.message; status.className = "error";
  } finally { sending = false; }
});
</script></body></html>`;
}

/** The store list: open, add and forget stores, and choose where quick capture goes. */
export function storesPage(token: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>kb stores</title>
<style>${BASE_STYLE}
body { padding: 20px; max-width: 720px; }
h1 { font-size: 18px; margin: 0 0 12px; } h2 { font-size: 14px; margin: 20px 0 8px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 6px 4px; border-bottom: 1px solid color-mix(in srgb, GrayText 30%, transparent); vertical-align: middle; }
td.actions { text-align: right; white-space: nowrap; }
form { display: flex; gap: 6px; flex-wrap: wrap; } form input { flex: 1; min-width: 140px; }
#status { margin-top: 12px; min-height: 1.2em; }
</style></head>
<body>
<h1>kb stores</h1>
<table><tbody id="rows"><tr><td class="muted">Loading…</td></tr></tbody></table>
<h2>Quick capture</h2>
<form id="capture"><label>Sends to <select id="captureStore"></select></label><span class="muted" id="hotkey"></span></form>
<h2>Add a local store</h2>
<form id="addLocal"><input name="name" placeholder="Name"><input name="path" placeholder="/path/to/root (made a store if it is not one)" required><button>Add</button></form>
<h2>Pair a remote store</h2>
<form id="addRemote"><input name="name" placeholder="Name (optional)"><input name="origin" placeholder="https://host.tailnet.ts.net" required><input name="code" placeholder="Pairing code" required autocomplete="off" spellcheck="false"><button>Pair</button></form>
<p class="muted">On the store's host, issue a one-use code (valid 10 minutes): <code>kb --root &lt;store&gt; --json action-invoke '{"id":"${CAPTURE_PAIR_CODE}"}'</code>. The credential it pairs is kept in the keychain.</p>
<div id="status"></div>
<p class="muted" id="kb"></p>
<script>${apiScript(token)}
const status = document.getElementById("status");
function say(text, error) { status.textContent = text; status.className = error ? "error" : "muted"; }
function cell(text, cls) { const td = document.createElement("td"); td.textContent = text; if (cls) td.className = cls; return td; }
function button(label, run) { const b = document.createElement("button"); b.textContent = label; b.onclick = run; return b; }
function only(text, cls) { const tr = document.createElement("tr"); tr.append(cell(text, cls)); return tr; }
// Forgetting asks on the page, by a second click within 5 s: the webview shows no confirm() dialog.
// Which store is asked about outlives a refresh, which rebuilds the rows (on focus, too).
let asking = null;
async function forget(s) {
  if (asking?.key !== s.key) {
    clearTimeout(asking?.timer);
    asking = { key: s.key, timer: setTimeout(() => { asking = null; say(""); refresh(); }, 5000) };
    say("Click again to forget " + s.name + ". " + (s.kind === "local" ? "Its files are not touched." : "Its credential is erased from the keychain."));
    refresh();
    return;
  }
  clearTimeout(asking.timer); asking = null;
  try { await api("/api/stores/remove", { key: s.key }); say(""); } catch (e) { say(e.message, true); }
  refresh();
}
async function refresh() {
  const rows = document.getElementById("rows");
  try {
    const { stores, problem, kb, passedOver, captureStore, hotkey } = await api("/api/stores");
    rows.replaceChildren();
    if (problem) rows.append(only("Your stores could not be listed. " + problem, "error"));
    else if (stores.length === 0) rows.append(only("No stores yet. Add one below.", "muted"));
    for (const s of stores) {
      const tr = document.createElement("tr");
      tr.append(cell(s.name), cell(s.kind === "local" ? s.root : s.origin, "muted"), cell(s.kind === "local" ? s.status : s.contract, "muted"));
      const actions = cell("", "actions");
      actions.append(button("Open", () => api("/api/stores/open", { key: s.key }).then(() => say("")).catch((e) => say(e.message, true))), " ",
        button(asking?.key === s.key ? "Really forget?" : "Forget", () => forget(s)));
      tr.append(actions); rows.append(tr);
    }
    const select = document.getElementById("captureStore");
    select.replaceChildren(new Option("the last store I used", ""), ...stores.map((s) => new Option(s.name, s.key)));
    select.value = captureStore || "";
    document.getElementById("hotkey").textContent = "Hotkey: " + hotkey;
    document.getElementById("kb").textContent = "Runs kb: " + kb + (passedOver.length ? " · passed over " + passedOver.join(" · ") : "");
  } catch (e) {
    // The app itself did not answer: say so where the stores would be.
    rows.replaceChildren(only("The store list could not be read. " + e.message, "error"));
  }
}
document.getElementById("captureStore").onchange = (e) => api("/api/settings/capture-store", { key: e.target.value }).catch((err) => say(err.message, true));
for (const id of ["addLocal", "addRemote"]) {
  document.getElementById(id).onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    say(id === "addLocal" ? "Adding…" : "Pairing…");
    try { await api("/api/stores/" + (id === "addLocal" ? "add-local" : "add-remote"), Object.fromEntries(new FormData(form))); form.reset(); say(""); }
    catch (e) { say(e.message, true); }
    refresh();
  };
}
refresh();
window.addEventListener("focus", refresh);
</script></body></html>`;
}
