import { present } from "@kb/model";
import type * as UiSdk from "@kb/ui-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import type { ProcedureStatus } from "@kb/contracts";
import { ProcedurePage } from "@/components/procedure/procedure-page";
import { useGraphStore } from "@/stores/graph.store";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@kb/ui-sdk", async (original) => ({
  ...(await original<typeof UiSdk>()),
  browserHost: () => ({ invoke }),
}));
let dom: InstalledDom;
let root: Root;
let container: HTMLDivElement;
const status: ProcedureStatus = {
  id: "trial",
  title: "Trial migration",
  current: "decide",
  steps: [
    {
      id: "decide",
      title: "Keep or roll back",
      decision: true,
      recommended: "rollback",
      notes: ["Two edited nodes will be undone."],
      done: false,
      check: { status: "not-done" },
      actions: [
        { id: "keep", title: "Keep", call: { action: "x.keep", input: {} } },
        { id: "rollback", title: "Roll back", call: { action: "x.rollback", input: {} } },
      ],
    },
  ],
};
const success = (id: string, output: unknown) => ({ status: "succeeded", id, output });
beforeAll(() => {
  dom = installDomGlobals();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => dom.restore());
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (id: string) => success(id, status));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function show(id = "trial") {
  await act(async () => {
    root.render(<ProcedurePage params={{ id }} host={{ placement: "page" }} />);
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
it("reads progress without taking a recommended decision, then sends the person's exact choice", async () => {
  await show();
  expect(invoke.mock.calls.map((c) => c[0])).toEqual(["procedure.status"]);
  expect(container.textContent).toContain("Two edited nodes");
  const done = { ...status, current: null, steps: status.steps.map((s) => ({ ...s, done: true })) };
  invoke.mockImplementation(async (id: string) =>
    id === "procedure.step"
      ? success(id, { receipt: success("x.keep", { kept: true }), status: done })
      : success(id, done),
  );
  await click("Keep");
  expect(invoke).toHaveBeenCalledWith("procedure.step", {
    procedure: "trial",
    step: "decide",
    action: "keep",
  });
  expect(container.textContent).toContain("Every step is done");
  expect(container.textContent).toContain('"kept": true');
});
it("keeps a nested failure visible after refreshing progress and never repeats the action", async () => {
  await show();
  invoke.mockImplementation(async (id: string) =>
    id === "procedure.step"
      ? success(id, {
          receipt: { status: "failed", id: "x.rollback", code: "conflict", message: "store moved" },
          status,
        })
      : success(id, status),
  );
  await click("Roll back");
  expect(container.textContent).toContain("store moved");
  expect(invoke.mock.calls.filter((c) => c[0] === "procedure.step")).toHaveLength(1);
});
it("retains the result when its action advances the page's graph revision", async () => {
  await show();
  invoke.mockImplementation(async (id: string) => {
    if (id !== "procedure.step") return success(id, status);
    useGraphStore.setState((s) => ({ rev: s.rev + 1 }));
    return success(id, { receipt: success("x.keep", { trial: "saved" }), status });
  });
  await click("Keep");
  expect(container.textContent).toContain('"trial": "saved"');
  expect(container.textContent).toContain("has not advanced");
});
it("ignores an old route's delayed status", async () => {
  let finish: (value: unknown) => void = vi.fn();
  invoke.mockImplementation((id: string, input: { procedure: string }) =>
    input.procedure === "old"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(success(id, status)),
  );
  await show("old");
  await show();
  await act(async () =>
    finish(success("procedure.status", { ...status, id: "old", title: "Old title" })),
  );
  expect(container.textContent).toContain("Trial migration");
  expect(container.textContent).not.toContain("Old title");
});
it("refuses to run from a failed status reading", async () => {
  invoke.mockResolvedValue({
    status: "failed",
    id: "procedure.status",
    code: "not_found",
    message: "Procedure unavailable",
  });
  await show();
  expect(container.textContent).toContain("Procedure unavailable");
  expect(container.querySelectorAll("li button")).toHaveLength(0);
  expect(invoke.mock.calls.every((call) => call[0] === "procedure.status")).toBe(true);
});
it("does not dispatch a second decision while the first is pending", async () => {
  await show();
  let finish: (value: unknown) => void = vi.fn();
  invoke.mockImplementation((id: string) =>
    id === "procedure.step"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(success(id, status)),
  );
  const keep = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Keep",
  );
  await act(async () => {
    keep?.click();
    keep?.click();
  });
  expect(invoke.mock.calls.filter((call) => call[0] === "procedure.step")).toHaveLength(1);
  await act(async () =>
    finish(success("procedure.step", { receipt: success("x.keep", {}), status })),
  );
  expect(container.textContent).toContain("has not advanced");
});
it("shows pending steps but keeps their actions disabled", async () => {
  const later = {
    ...present(status.steps[0], "test decision"),
    id: "later",
    title: "Later step",
    actions: [{ id: "later", title: "Later action", call: { action: "x.later", input: {} } }],
  };
  invoke.mockImplementation(async (id: string) =>
    success(id, { ...status, steps: [...status.steps, later] }),
  );
  await show();
  const button = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === "Later action",
  );
  expect(button?.disabled).toBe(true);
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Current");
  expect(container.textContent).toContain("Pending");
});
it("summarizes output and leaves raw data in a closed Details disclosure", async () => {
  await show();
  invoke.mockImplementation(async (id: string) =>
    id === "procedure.step"
      ? success(id, {
          receipt: success("x.keep", {
            state: "verified",
            backup: { id: "safety-1", nodes: 12, at: "2026-11-13T07:00:00Z" },
            problems: [],
          }),
          status,
        })
      : success(id, status),
  );
  await click("Keep");
  const details = container.querySelector("details");
  expect(details?.open).toBe(false);
  expect(details?.querySelector("summary")?.textContent).toBe("Details");
  const summary = container.querySelector("dl");
  expect(summary?.textContent).toContain("safety-1");
  expect(summary?.textContent).toContain("12");
  expect(summary?.textContent).toContain("No problems");
  expect(summary?.textContent).not.toContain('"state"');
});
