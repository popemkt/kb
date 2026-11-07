// @vitest-environment happy-dom
/**
 * The page-head backdrop's double-click (DESIGN-UI.md → Page-head backdrops
 * → Its actions): a double-click on the backdrop's own area, where nothing
 * of the page's takes a double-click, opens its actions; one meant for the
 * page (text it selects, a control, a link, anything editable) is the
 * page's, and the gesture never takes the default from it.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { watchBackdropDoubleClick } from "./backdrop-gesture";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(id);
  return el;
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** A frame 0..800 × 0..300 behind a head, under a region that covers it. */
function stage() {
  document.body.innerHTML = `
    <main id="region" style="position:relative">
      <div id="space"><div id="frame" data-backdrop="probe"></div></div>
      <h1 id="title" contenteditable="true">A title</h1>
      <p id="prose">Some words</p>
      <button id="control">Go</button>
      <a id="link" href="/x">x</a>
      <div id="empty"></div>
    </main>
    <aside id="outside"></aside>`;
  byId("frame").getBoundingClientRect = () => rect(0, 0, 800, 300);
  byId("region").getBoundingClientRect = () => rect(0, 0, 1000, 2000);
}

function dblclick(target: Element, x: number, y: number): MouseEvent {
  const event = new MouseEvent("dblclick", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
  return event;
}

const selected = () => document.getSelection()?.toString() ?? "";

describe("a double-click over a page-head backdrop", () => {
  let opened: number;
  let stop: () => void;

  beforeEach(() => {
    stage();
    opened = 0;
    stop = watchBackdropDoubleClick(byId("frame"), () => opened++);
    document.getSelection()?.removeAllRanges();
  });
  afterEach(() => stop());

  test("on the backdrop's own area opens its actions, and keeps the page's default", () => {
    const event = dblclick(byId("empty"), 400, 100);
    expect(opened).toBe(1);
    expect(event.defaultPrevented).toBe(false);
  });

  test("outside the frame, or outside what covers it, is not the backdrop's", () => {
    dblclick(byId("empty"), 400, 600);
    dblclick(byId("outside"), 400, 100);
    expect(opened).toBe(0);
  });

  test("on anything editable, a control or a link is the page's", () => {
    dblclick(byId("title"), 100, 50);
    dblclick(byId("control"), 100, 50);
    dblclick(byId("link"), 100, 50);
    expect(opened).toBe(0);
  });

  /** Select the prose's words, laid out at `box`, as a double-click selects a word. */
  const select = (box: DOMRect) => {
    const range = document.createRange();
    range.selectNodeContents(byId("prose"));
    range.getClientRects = () => [box] as unknown as DOMRectList;
    document.getSelection()?.addRange(range);
  };

  test("one that selected the text under the pointer is the page's", () => {
    select(rect(80, 140, 120, 20));
    dblclick(byId("empty"), 100, 150);
    expect(opened).toBe(0);
  });

  /** The press that starts a double-click (`detail` 1): the browser has not yet changed the selection for it. */
  const press = (x: number, y: number) =>
    byId("empty").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y, detail: 1 }),
    );

  test("one beside a word the browser selected (the nearest, from empty space) is the backdrop's, and the stray word is let go", () => {
    press(400, 60);
    select(rect(80, 140, 120, 20));
    dblclick(byId("empty"), 400, 60);
    expect(opened).toBe(1);
    expect(selected()).toBe("");
  });

  test("a selection made before the double-click is the person's, and stays", () => {
    select(rect(80, 140, 120, 20));
    press(400, 60);
    dblclick(byId("empty"), 400, 60);
    expect(opened).toBe(1);
    expect(selected()).toBe("Some words");
  });

  test("one the page already handled is the page's", () => {
    byId("empty").addEventListener("dblclick", (e) => e.preventDefault());
    dblclick(byId("empty"), 400, 100);
    expect(opened).toBe(0);
  });

  test("a frame laid out after it was watched is heard where it lies now", () => {
    stop();
    // As a head mounts: the frame has no box yet, and its breathing room (its parent) has one.
    byId("frame").getBoundingClientRect = () => rect(0, 0, 0, 0);
    byId("space").getBoundingClientRect = () => rect(0, 0, 800, 120);
    stop = watchBackdropDoubleClick(byId("frame"), () => opened++);
    byId("frame").getBoundingClientRect = () => rect(0, 0, 800, 300);
    dblclick(byId("empty"), 400, 200);
    expect(opened).toBe(1);
  });

  test("stopped, it hears nothing", () => {
    stop();
    dblclick(byId("empty"), 400, 100);
    expect(opened).toBe(0);
  });
});
