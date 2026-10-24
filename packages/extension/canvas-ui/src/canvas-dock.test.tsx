import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { CanvasDock, DockPanel } from "./canvas-dock";

const dom = new Window();
let container: HTMLElement;
let root: Root;

beforeAll(() => {
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

beforeEach(() => {
  container = dom.document.createElement("div") as unknown as HTMLElement;
  dom.document.body.appendChild(container as never);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(compact: boolean) {
  act(() => {
    root.render(
      <CanvasDock head={null} compact={compact}>
        <DockPanel name="style" title="Style">
          <p>style rows</p>
        </DockPanel>
        <DockPanel name="comments" title="Comments">
          <p>comment rows</p>
        </DockPanel>
      </CanvasDock>,
    );
  });
}

const open = (name: string) =>
  container
    .querySelector(`section[aria-label="${name}"] [aria-expanded]`)
    ?.getAttribute("aria-expanded") === "true";
const turn = (name: string) =>
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`section[aria-label="${name}"] [aria-expanded]`)
      ?.click();
  });

describe("the dock's folds", () => {
  test("a panel no one turned follows the stage; one a person turned keeps its fold across the breakpoint", () => {
    render(true);
    expect(open("style")).toBe(false);
    expect(open("comments")).toBe(false);
    // Opened on a narrow stage, it stays open as the stage widens and narrows again.
    turn("style");
    expect(open("style")).toBe(true);
    render(false);
    expect(open("style")).toBe(true);
    expect(open("comments")).toBe(true);
    // Folded on a wide stage, it stays folded as the stage narrows and widens again.
    turn("style");
    render(true);
    expect(open("style")).toBe(false);
    render(false);
    expect(open("style")).toBe(false);
    expect(open("comments")).toBe(true);
  });
});
