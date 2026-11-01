import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ViewError, ViewErrorBoundary } from "./view-error-boundary";

function Boom({ fail }: { fail: boolean }): ReactElement {
  if (fail) throw new Error("webgl kaboom");
  return createElement("div", { "data-testid": "ok" }, "ok");
}

/** A view whose chunk the server no longer has: the tab outlived its build. */
function Gone(): ReactElement {
  throw new TypeError(
    "Failed to fetch dynamically imported module: https://kb/static/composer-page-CSoHrcCV.js",
  );
}

function Shell({ children }: { children: ReactNode }): ReactElement {
  return createElement(
    "div",
    { "data-testid": "shell-chrome" },
    createElement("header", null, "kb chrome"),
    createElement("main", null, children),
  );
}

describe("ViewErrorBoundary", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: typeof console.error;
  let reloads = 0;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    g.sessionStorage = dom.sessionStorage;
    g.location = { pathname: "/", reload: () => void reloads++ };
  });

  beforeEach(() => {
    consoleError = console.error;
    console.error = () => {};
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    console.error = consoleError;
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders children when healthy", () => {
    act(() => {
      root.render(
        createElement(ViewErrorBoundary, { children: createElement(Boom, { fail: false }) }),
      );
    });
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="view-error"]')).toBeNull();
  });

  it("contains a crash inside the view while shell chrome stays mounted", () => {
    act(() => {
      root.render(
        createElement(Shell, {
          children: createElement(ViewErrorBoundary, {
            title: "Graph crashed",
            children: createElement(Boom, { fail: true }),
          }),
        }),
      );
    });
    expect(container.querySelector('[data-testid="shell-chrome"]')).not.toBeNull();
    expect(container.textContent).toContain("kb chrome");
    expect(container.querySelector('[data-testid="view-error"]')).not.toBeNull();
    expect(container.textContent).toContain("Graph crashed");
    expect(container.textContent).toContain("webgl kaboom");
  });

  it("resetKey recovers after the child stops throwing", () => {
    function Controlled({ failProp }: { failProp: boolean }): ReactElement {
      return createElement(ViewErrorBoundary, {
        title: "Canvas crashed",
        resetKey: failProp ? "bad" : "good",
        children: createElement(Boom, { fail: failProp }),
      });
    }

    act(() => {
      root.render(createElement(Controlled, { failProp: true }));
    });
    expect(container.querySelector('[data-testid="view-error"]')).not.toBeNull();

    act(() => {
      root.render(createElement(Controlled, { failProp: false }));
    });
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="view-error"]')).toBeNull();
  });

  it("reloads into the new build once, saying so, when its view's chunk is gone", () => {
    const entry = dom.document.createElement("script");
    entry.setAttribute("type", "module");
    entry.setAttribute("src", "https://kb/static/index-old.js");
    dom.document.head.appendChild(entry);
    reloads = 0;
    const gallery = (key: string) =>
      createElement(ViewErrorBoundary, {
        title: "Gallery crashed",
        resetKey: key,
        children: createElement(Gone),
      });

    act(() => {
      root.render(gallery("first"));
    });
    expect(reloads).toBe(1);
    expect(container.textContent).toContain("kb was updated");
    expect(container.textContent).not.toContain("Gallery crashed");

    // The reload landed on the same build: the failure is shown, once.
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    dom.sessionStorage.setItem("kb.reloaded-for-build", "https://kb/static/index-same.js");
    entry.setAttribute("src", "https://kb/static/index-same.js");
    act(() => {
      root.render(gallery("again"));
    });
    expect(reloads).toBe(1);
    expect(container.textContent).toContain("Gallery crashed");
    expect(container.textContent).toContain("Failed to fetch dynamically imported module");
    entry.remove();
  });

  it("ViewError retry button invokes onRetry", () => {
    let clicked = false;
    act(() => {
      root.render(
        createElement(ViewError, {
          title: "Canvas crashed",
          onRetry: () => {
            clicked = true;
          },
        }),
      );
    });
    const btn = container.querySelector('[data-testid="view-error-retry"]') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(clicked).toBe(true);
  });
});
