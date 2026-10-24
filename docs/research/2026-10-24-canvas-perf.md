# Canvas 2D performance: benchmark and numbers

Date: 2026-10-24. Branch `feature/canvas-perf`. The bar and the contract it
rests on are [DESIGN-UI.md → Canvas → Update cost](../../DESIGN-UI.md#update-cost);
this record holds what was measured and how. The frame times are not gated
(`#gap` `01M5PMJEGCJPMVNCKBDYZ0V57G`); `canvas-update-cost.test.tsx` gates
the render counts.

## The benchmark

One canvas of 2000 items in a 50 × 40 grid, alternating text cards and
shapes, and 1000 edges bound between neighbours, made by this script and
written with `kb set <canvas> sys.f.canvas "$(node gen.mjs)"`:

```js
// 2000 items in a 50x40 grid, 1000 edges between neighbours.
const nodes = [], edges = [];
const COLS = 50;
for (let i = 0; i < 2000; i++) {
  const x = (i % COLS) * 220, y = Math.floor(i / COLS) * 160;
  const id = `n${i}`;
  if (i % 2) nodes.push({ id, type: "text", x, y, width: 160, height: 80, text: `Item ${i}` });
  else nodes.push({ id, type: "shape", shape: i % 4 ? "rect" : "ellipse", x, y, width: 160, height: 80, label: `Shape ${i}` });
}
for (let i = 0; i < 1000; i++) {
  const a = i * 2, b = (i % COLS === COLS - 1) ? a + COLS : a + 1;
  edges.push({ id: `e${i}`, fromNode: `n${a}`, toNode: `n${Math.min(b, 1999)}`, fromSide: "right", toSide: "left" });
}
process.stdout.write(JSON.stringify({ nodes, edges }));
```

Served by the production build (`kb ui`, with `packages/app/ui/dist`
removed first, since the build's fingerprint does not cover extension
sources) in a scratch repository and `KB_HOME`, and driven by agent-browser
(headless Chrome on the Metal GPU, 1440 × 900). The harness below is
evaluated in the page. It sends one synthetic input per animation frame and
records the frame-to-frame deltas:

- **pan**: 120 wheel steps, out and back;
- **zoom**: 100 ⌃-wheel steps, out and back in;
- **1-item drag**: 120 pointer moves on one card;
- **N-item drag**: the same on one card of a marquee selection, 30 at 100%,
  and 56 after six zoom-out steps (61%).

```js
// Canvas perf harness: synthetic input once per animation frame, frame deltas recorded.
(() => {
  const proto = Element.prototype;
  if (!proto.__benchPatched) {
    const cap = proto.setPointerCapture;
    proto.setPointerCapture = function (id) { try { cap.call(this, id); } catch {} };
    const rel = proto.releasePointerCapture;
    proto.releasePointerCapture = function (id) { try { rel.call(this, id); } catch {} };
    proto.__benchPatched = true;
  }
  const vp = () => document.querySelector("[data-canvas-viewport]");
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const ptr = (target, type, x, y, extra = {}) =>
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse",
      isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, ...extra,
    }));
  const wheel = (x, y, dx, dy, ctrl = false) =>
    vp().dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy, ctrlKey: ctrl,
    }));
  const stats = (deltas, mutations, work) => {
    const s = [...deltas].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return {
      frames: s.length,
      p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1),
      over17: s.filter((d) => d > 17.5).length, over33: s.filter((d) => d > 34).length,
      fps: +(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1),
      workMs: +work.toFixed(1), mutations,
    };
  };
  async function run(frames, step) {
    let mutations = 0;
    const mo = new MutationObserver((l) => { mutations += l.length; });
    mo.observe(vp(), { subtree: true, attributes: true, childList: true, characterData: true });
    await raf(); await raf();
    const deltas = []; let last = performance.now(); let work = 0;
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      step(i);
      work += performance.now() - t0;
      const t = await raf();
      deltas.push(t - last); last = t;
    }
    await raf(); await raf();
    mo.disconnect();
    return stats(deltas, mutations, work);
  }
  const rectOf = (id) => document.querySelector(`[data-card-id="${id}"] > :last-child`).getBoundingClientRect();
  const center = () => { const r = vp().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };
  window.__bench = {
    pan: (n = 120) => run(n, (i) => { const c = center(); wheel(c.x, c.y, i < n / 2 ? 6 : -6, i < n / 2 ? 4 : -4); }),
    // 12 steps out (x0.92) then 13 in (x1.08) come back to the zoom they left.
    zoom: (n = 100) => run(n, (i) => { const c = center(); wheel(c.x, c.y, 0, i % 25 < 12 ? 10 : -10, true); }),
    async reset() {
      document.activeElement?.blur?.();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", code: "Digit0", metaKey: true, ctrlKey: true, bubbles: true }));
      await raf(); await raf();
      const b = rectOf("n0"); const r = vp().getBoundingClientRect();
      wheel(r.left + 100, r.top + 100, b.left - (r.left + 40), b.top - (r.top + 40));
      await raf(); await raf();
      const a = rectOf("n0"); return [Math.round(a.left - r.left), Math.round(a.top - r.top), this.zoomLevel()];
    },
    async drag(id, n = 120) {
      const b = rectOf(id); const x0 = b.left + b.width / 2, y0 = b.top + b.height / 2;
      const target = document.querySelector(`[data-card-id="${id}"] > :last-child`);
      ptr(target, "pointerdown", x0, y0);
      await raf();
      const res = await run(n, (i) => { const d = i < n / 2 ? i : n - i; ptr(vp(), "pointermove", x0 + d * 2, y0 + d); });
      ptr(vp(), "pointerup", x0, y0);
      return res;
    },
    async marquee(x0, y0, x1, y1) {
      ptr(vp(), "pointerdown", x0, y0); await raf();
      for (let i = 1; i <= 5; i++) { ptr(vp(), "pointermove", x0 + ((x1 - x0) * i) / 5, y0 + ((y1 - y0) * i) / 5); await raf(); }
      ptr(vp(), "pointerup", x1, y1); await raf(); await raf();
      return document.querySelectorAll("[data-card-id][data-selected]").length;
    },
    clear() { ptr(vp(), "pointerdown", center().r.left + 3, center().r.top + 3); ptr(vp(), "pointerup", center().r.left + 3, center().r.top + 3); },
    // Zoom out `steps` wheel notches about the centre, then select all the stage shows.
    async selectShown(steps) {
      for (let i = 0; i < steps; i++) { const c = center(); wheel(c.x, c.y, 0, 10, true); await raf(); }
      await raf(); await raf();
      const r = vp().getBoundingClientRect();
      const n = await this.marquee(r.left + 4, r.top + 4, r.right - 4, r.bottom - 4);
      const ids = [...document.querySelectorAll("[data-card-id][data-selected]")].map((e) => e.dataset.cardId);
      return { selected: n, lead: ids[Math.floor(ids.length / 2)], zoom: this.zoomLevel() };
    },
    zoomLevel() { return document.querySelector(".text-label.text-foreground\\/30")?.textContent; },
  };
  return "ok";
})();
```

A write elsewhere is measured by a long-task observer and a frame recorder
left running while ten `kb add` of unrelated nodes land a second apart,
against a control that writes nothing. Headless Chrome idles at about
36fps with nothing to paint, so the two are compared with each other, not
with 60.

## Numbers

Before is `deb7c881`, after is this branch, both measured in the same
sitting on the same machine with the same harness. Each cell is fps, then
p95 and the longest frame in ms.

| Scenario     | Before               | After               |
| ------------ | -------------------- | ------------------- |
| pan          | 13.5 · 100.3 · 184.9 | 59.1 · 18.6 · 23.6  |
| zoom         | 14.3 · 99.7 · 124.2  | 59.5 · 18.1 · 23.2  |
| 1-item drag  | 13.5 · 98.8 · 141.7  | 60.0 · 17.7 · 18.5  |
| 30-item drag | 14.4 · 91.7 · 106.9  | 58.8 · 18.6 · 24.9  |
| 56-item drag | 13.6 · 99.5 · 123.9  | 59.4 · 18.6 · 25.4  |

Ten unrelated writes: no long task in two runs of three, the same frame
shape as the control; the third had one task of 57ms, not seen again.

## What moved the numbers

- Memoised items and edges, and the floor window, took pan, zoom and the
  1-item drag from about 14fps to 60.
- The many-item drag stayed near 26fps with the main thread idle: the
  compositor was repainting a raised (blurred) shadow on every resize and
  rotate handle of every carried item. Hiding the handles while carrying,
  as tldraw does, took it to 60.
- A zoom that crosses a half octave brought in about 400 items in one
  225ms frame; drawing them as a deferred update removed the spike.
- In the development profile: the screen report's visible-items walk, the
  lints on every preview frame, and the paint order sorted again per
  reader, each now done once per rest, release or document.
