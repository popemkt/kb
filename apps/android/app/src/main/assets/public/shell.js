// The shell page's three views, drawn from the KbShell plugin's state.
// Capacitor's native bridge (injected only into this origin) provides
// `Capacitor.nativePromise` and `Capacitor.addListener`; the shell ships no
// npm package, so those two are all it uses.

const cap = window.Capacitor;
const call = (method, options = {}) => cap.nativePromise("KbShell", method, options);

const PAIR_CODE_COMMAND = `kb --root <store> --json action-invoke '{"id":"capture.pairCode"}'`;

let state = { stores: [], entries: [], pending: 0, failed: 0 };
let filter = "pending";
let pairing = { open: false, busy: false, message: null, url: "https://", code: "" };
let draft = "";
let note = null;

const view = document.getElementById("view");

/** One element, with attributes and children; `on*` attributes are listeners. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** The route in the fragment: `#/queue?offline=…&why=…` → {name: "queue", params}. */
function route() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return { name: path || "stores", params: new URLSearchParams(query) };
}

async function act(method, options) {
  try {
    const next = await call(method, options);
    if (next && next.entries) state = next;
  } catch (err) {
    note = { bad: true, text: err.message ?? String(err) };
  }
  render();
}

function when(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function storesView() {
  const stores = state.stores;
  const form = () => {
    const submit = async (event) => {
      event.preventDefault();
      pairing = { ...pairing, busy: true, message: null };
      render();
      try {
        const result = await call("pair", { url: pairing.url, code: pairing.code });
        pairing = result.ok
          ? { open: false, busy: false, message: null, url: "https://", code: "" }
          : { ...pairing, busy: false, message: result.message };
        if (result.ok) note = { bad: false, text: result.message };
      } catch (err) {
        pairing = { ...pairing, busy: false, message: err.message ?? String(err) };
      }
      render();
    };
    return h(
      "form",
      { class: "card", onsubmit: submit },
      h("div", { class: "title" }, "Pair a store"),
      h(
        "p",
        { class: "meta" },
        "On the machine that serves the store, issue a one-use code: ",
        h("code", {}, PAIR_CODE_COMMAND),
        ". Then enter the address you open the store's kb at, and the code.",
      ),
      h(
        "label",
        {},
        "Store URL",
        h("input", {
          type: "url",
          inputmode: "url",
          autocomplete: "url",
          value: pairing.url,
          oninput: (e) => (pairing.url = e.target.value),
        }),
      ),
      h(
        "label",
        {},
        "Pairing code",
        h("input", {
          autocomplete: "one-time-code",
          autocapitalize: "off",
          spellcheck: "false",
          value: pairing.code,
          oninput: (e) => (pairing.code = e.target.value),
        }),
      ),
      pairing.message && h("div", { class: "bad" }, pairing.message),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "primary", type: "submit", disabled: pairing.busy }, pairing.busy ? "Pairing…" : "Pair"),
        stores.length > 0 &&
          h("button", { class: "ghost", type: "button", onclick: () => ((pairing.open = false), render()) }, "Cancel"),
      ),
    );
  };
  return [
    h("h1", {}, "Stores"),
    h(
      "p",
      { class: "lead" },
      stores.length === 0
        ? "Pair a store to open its kb here and send it what you share."
        : "Open a store's kb. Shares go to the store marked below.",
    ),
    ...stores.map((store) =>
      h(
        "section",
        { class: "card" },
        h("div", { class: "title" }, store.name, store.current && h("span", { class: "chip" }, "Shares go here")),
        h("div", { class: "mono meta" }, store.url),
        h("div", { class: store.ok ? "ok" : "bad" }, store.status),
        h(
          "div",
          { class: "actions" },
          h("button", { class: "primary", onclick: () => call("open", { key: store.key }) }, "Open"),
          h(
            "button",
            {
              class: "ghost",
              onclick: () => {
                if (confirm(`Forget ${store.name}? Its queued captures wait until you pair it again.`))
                  act("forget", { key: store.key });
              },
            },
            "Forget",
          ),
        ),
      ),
    ),
    stores.length === 0 || pairing.open
      ? form()
      : h("button", { onclick: () => ((pairing.open = true), render()) }, "Pair a store"),
  ];
}

function entryRow(entry) {
  const meta = [
    entry.store,
    when(entry.capturedAt),
    entry.files > 0 && `${entry.files} file${entry.files === 1 ? "" : "s"}`,
    entry.source && `from ${entry.source}`,
    entry.attempts > 0 && `${entry.attempts} attempt${entry.attempts === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return h(
    "section",
    { class: "card" },
    h("div", { class: "summary" }, entry.summary),
    h("div", { class: "meta" }, meta.join("  ·  ")),
    entry.reason && h("div", { class: entry.status === "failed" ? "bad" : "wait" }, entry.reason),
    entry.nodeId && h("div", { class: "mono meta" }, `node ${entry.nodeId}`),
    h(
      "div",
      { class: "actions" },
      entry.status !== "sent" &&
        h("button", { onclick: () => act("retry", { id: entry.id }) }, entry.status === "failed" ? "Retry" : "Retry now"),
      h(
        "button",
        { class: "ghost", onclick: () => act("discard", { id: entry.id }) },
        entry.status === "sent" ? "Remove" : "Discard",
      ),
    ),
  );
}

function queueView(params) {
  const offline = params.get("offline");
  const counts = { pending: 0, sent: 0, failed: 0 };
  for (const entry of state.entries) counts[entry.status] += 1;
  const rows = state.entries.filter((entry) => entry.status === filter);
  const current = state.stores.find((store) => store.current);
  return [
    offline &&
      h(
        "section",
        { class: "card notice" },
        h("div", { class: "title" }, `Offline — ${offline} did not load`),
        h(
          "div",
          { class: "meta" },
          `${params.get("why") ?? ""}. `,
          counts.pending === 0
            ? "Nothing is waiting to be sent."
            : `Captures are queued (${counts.pending}) and go out when the store is reachable.`,
        ),
        h(
          "div",
          { class: "actions" },
          current && h("button", { class: "primary", onclick: () => call("open", { key: current.key }) }, "Try again"),
          h("button", { onclick: () => (location.hash = "#/capture") }, "Capture"),
        ),
      ),
    !offline && h("h1", {}, "Queue"),
    !offline &&
      h("p", { class: "lead" }, "What this phone has captured: waiting, sent to its store, or refused by it."),
    h(
      "div",
      { class: "filters", role: "group" },
      ...["pending", "sent", "failed"].map((status) =>
        h(
          "button",
          { "aria-pressed": String(filter === status), onclick: () => ((filter = status), render()) },
          `${status[0].toUpperCase()}${status.slice(1)} ${counts[status]}`,
        ),
      ),
    ),
    rows.length === 0 ? h("div", { class: "empty" }, `Nothing ${filter}.`) : rows.map(entryRow),
  ];
}

function captureView() {
  const current = state.stores.find((store) => store.current);
  const submit = async (event) => {
    event.preventDefault();
    if (draft.trim() === "") return;
    try {
      await call("enqueue", { text: draft });
      draft = "";
      note = { bad: false, text: `Queued · ${current?.name ?? "not paired yet"}` };
    } catch (err) {
      note = { bad: true, text: `Not queued: ${err.message ?? String(err)}` };
    }
    render();
  };
  const field = h("textarea", {
    placeholder: "A thought, a link, a todo…",
    oninput: (e) => (draft = e.target.value),
  });
  field.value = draft;
  queueMicrotask(() => field.focus());
  return [
    h("h1", {}, "Capture"),
    h(
      "p",
      { class: "lead" },
      current
        ? `To ${current.name}. It lands where that store files captures (today, with Days on), even offline.`
        : "Not paired yet: it waits on this phone and goes to the first store you pair.",
    ),
    h(
      "form",
      { class: "card", onsubmit: submit },
      field,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "primary", type: "submit" }, "Queue"),
        current && h("button", { type: "button", class: "ghost", onclick: () => call("open", { key: current.key }) }, `Open ${current.name}`),
      ),
    ),
  ];
}

function render() {
  const { name, params } = route();
  for (const link of document.querySelectorAll(".tabs a")) {
    if (link.dataset.view === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const count = document.getElementById("queue-count");
  const waiting = state.pending + state.failed;
  count.hidden = waiting === 0;
  count.textContent = String(waiting);
  const views = { stores: storesView, queue: queueView, capture: captureView };
  const shown = (views[name] ?? storesView)(params);
  const banner = note && h("div", { class: note.bad ? "bad" : "toast", role: "status" }, note.text);
  view.replaceChildren(...[banner, shown].flat(Infinity).filter(Boolean));
}

window.addEventListener("hashchange", () => {
  note = null;
  render();
});

if (cap?.nativePromise === undefined) {
  view.replaceChildren(h("p", { class: "lead" }, "This page runs inside the kb app."));
} else {
  render();
  cap.addListener("KbShell", "state", (next) => {
    state = next;
    render();
  });
  act("state");
}
