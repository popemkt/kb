import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ActionInvocation } from "@kb/contracts";
import type { ActionReview, ApprovalView } from "../lib/action-review";
import { ActionApproval } from "./action-approval";
import { SandboxApprovalCard } from "./sandbox-approval-card";

const contributions = vi.hoisted(() => ({ rows: [] as { id: string; value: ActionReview }[] }));
vi.mock("../lib/plugins", () => ({ useContributions: () => contributions.rows }));
let dom: Window;
let container: HTMLDivElement;
let root: Root;
const invocation: ActionInvocation = {
  id: "sandbox.trust",
  actor: "script",
  input: { digest: "synthetic" },
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
  contributions.rows = [];
  container = dom.document.createElement("div") as unknown as HTMLDivElement;
  dom.document.body.appendChild(container as unknown as never);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`missing ${label}`);
  return found;
}

it("holds approval while evidence loads, but an explicit decline remains available", async () => {
  const reading = Promise.withResolvers<ApprovalView | null>();
  contributions.rows = [
    { id: invocation.id, value: { action: invocation.id, read: () => reading.promise } },
  ];
  const answer = vi.fn();
  await act(async () => root.render(<ActionApproval invocation={invocation} answer={answer} />));
  expect(button("Approve once").disabled).toBe(true);
  await act(async () => button("Decline").click());
  expect(answer).toHaveBeenCalledExactlyOnceWith(false);
  await act(async () =>
    reading.resolve({ content: <p>Exact pinned source</p>, approveLabel: "Trust this digest" }),
  );
  expect(container.textContent).toContain("Exact pinned source");
  expect(button("Trust this digest").disabled).toBe(false);
});

it("the script approval card uses the same evidence and sends the person's affirmative answer", async () => {
  contributions.rows = [
    {
      id: invocation.id,
      value: {
        action: invocation.id,
        read: () =>
          Promise.resolve({
            content: <p>Reviewed file digest</p>,
            approveLabel: "Trust this digest",
          }),
      },
    },
  ];
  const answer = vi.fn();
  await act(async () => root.render(<SandboxApprovalCard asking={{ invocation, answer }} />));
  expect(container.textContent).toContain("Reviewed file digest");
  await act(async () => button("Trust this digest").click());
  expect(answer).toHaveBeenCalledExactlyOnceWith(true);
});

it("failed review cannot fall back to generic approval, and an older response cannot unlock a new input", async () => {
  const older = Promise.withResolvers<ApprovalView | null>();
  const newer = Promise.withResolvers<ApprovalView | null>();
  const read = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  contributions.rows = [{ id: invocation.id, value: { action: invocation.id, read } }];
  const answer = vi.fn();
  await act(async () => root.render(<ActionApproval invocation={invocation} answer={answer} />));
  await act(async () =>
    root.render(
      <ActionApproval
        invocation={{ ...invocation, input: { digest: "replacement" } }}
        answer={answer}
      />,
    ),
  );
  await act(async () =>
    older.resolve({ content: <p>Obsolete review</p>, approveLabel: "Trust this digest" }),
  );
  expect(container.textContent).not.toContain("Obsolete review");
  expect(button("Approve once").disabled).toBe(true);
  await act(async () => newer.reject(new Error("Source changed while reading")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Source changed");
  expect(button("Approve once").disabled).toBe(true);
  expect(answer).not.toHaveBeenCalled();
});

it("inputs a review does not describe retain the generic action review", async () => {
  contributions.rows = [
    { id: invocation.id, value: { action: invocation.id, read: () => Promise.resolve(null) } },
  ];
  await act(async () => root.render(<ActionApproval invocation={invocation} answer={() => {}} />));
  expect(container.textContent).toContain("synthetic");
  expect(button("Approve once").disabled).toBe(false);
});

it("asks matching readers in order and uses the first review that describes the input", async () => {
  const later = vi.fn(() =>
    Promise.resolve({
      content: <p>Exact shortcut content</p>,
      approveLabel: "Confirm this override",
    }),
  );
  const unused = vi.fn(() => Promise.resolve(null));
  contributions.rows = [
    { id: "extensions", value: { action: invocation.id, read: () => Promise.resolve(null) } },
    { id: "shortcuts", value: { action: invocation.id, read: later } },
    { id: "unused", value: { action: invocation.id, read: unused } },
  ];
  await act(async () => root.render(<ActionApproval invocation={invocation} answer={() => {}} />));
  expect(container.textContent).toContain("Exact shortcut content");
  expect(button("Confirm this override").disabled).toBe(false);
  expect(later).toHaveBeenCalledExactlyOnceWith(invocation);
  expect(unused).not.toHaveBeenCalled();
});

it("a failed matching reader cannot fall through to another review", async () => {
  const later = vi.fn(() =>
    Promise.resolve({ content: <p>Wrong review</p>, approveLabel: "Approve" }),
  );
  contributions.rows = [
    {
      id: "failed",
      value: { action: invocation.id, read: () => Promise.reject(new Error("Stale input")) },
    },
    { id: "later", value: { action: invocation.id, read: later } },
  ];
  await act(async () => root.render(<ActionApproval invocation={invocation} answer={() => {}} />));
  expect(container.textContent).toContain("Stale input");
  expect(button("Approve once").disabled).toBe(true);
  expect(later).not.toHaveBeenCalled();
});
