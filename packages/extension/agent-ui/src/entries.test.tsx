import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { definePlugin } from "@kb/plugin";
import { ActionReviewPoint, syncUiPlugins, type ApprovalView } from "@kb/ui-sdk";
import type { ToolEntry } from "@kb/agent";
import { Entry } from "./entries";
let dom: Window;
let container: HTMLDivElement;
let root: Root;
const entry: ToolEntry = {
  kind: "tool",
  id: "call",
  action: "sandbox.trust",
  title: "Trust code",
  input: { digest: "synthetic" },
  approval: true,
  ask: null,
  state: "awaiting",
  receipt: null,
  decision: null,
};
beforeAll(() => {
  dom = new Window();
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});
beforeEach(() => {
  container = dom.document.createElement("div") as unknown as HTMLDivElement;
  dom.document.body.appendChild(container as unknown as never);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  syncUiPlugins([]);
  container.remove();
});
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (found === undefined) throw new Error(label);
  return found;
}
function review(read: () => Promise<ApprovalView | null>) {
  syncUiPlugins([
    definePlugin({
      name: "review-fixture",
      apply: (ctx) =>
        ctx.contribute(ActionReviewPoint, {
          id: "trust",
          value: { action: "sandbox.trust", read },
        }),
    }),
  ]);
}
it("the agent dock waits for extension evidence and submits the person's approval", async () => {
  const evidence = Promise.withResolvers<ApprovalView | null>();
  review(() => evidence.promise);
  const decide = vi.fn();
  await act(async () => root.render(<Entry entry={entry} decide={decide} />));
  expect(container.textContent).toContain("The agent wants to run");
  expect(button("Approve once").disabled).toBe(true);
  await act(async () =>
    evidence.resolve({
      content: <p>Pinned extension, reach and reviewed diff</p>,
      approveLabel: "Trust this digest",
    }),
  );
  expect(container.textContent).toContain("Pinned extension, reach and reviewed diff");
  await act(async () => button("Trust this digest").click());
  expect(decide).toHaveBeenCalledExactlyOnceWith("call", true);
});
it("a failed dock review never enables approval and Decline still answers false", async () => {
  const evidence = Promise.withResolvers<ApprovalView | null>();
  review(() => evidence.promise);
  const decide = vi.fn();
  await act(async () => root.render(<Entry entry={entry} decide={decide} />));
  await act(async () => evidence.reject(new Error("Review failed")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Review failed");
  expect(button("Approve once").disabled).toBe(true);
  await act(async () => button("Decline").click());
  expect(decide).toHaveBeenCalledExactlyOnceWith("call", false);
});
