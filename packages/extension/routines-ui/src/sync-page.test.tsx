/**
 * The sync services page over a graph the test holds: adding a service,
 * walking its setup and connecting. Node calls are applied to the graph as a
 * local commit does, and the host's `ext.routines.*` answers are scripted, so
 * each step is checked by what it wrote, what it asked the host and what it
 * then shows. No Google, and no secret ever comes back to the page.
 */
import { act, useMemo, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import type { ActionReceipt } from "@kb/contracts";
import { routineOption, ROUTINE_FIELDS as F, ROUTINE_TAGS as T } from "@kb/routines";
import { getPath, setToastSink, subscribePath, syncUiPlugins, type OutlineNode } from "@kb/ui-sdk";
import {
  installDomGlobals,
  testBrowserHost,
  testHostPlugin,
  type InstalledDom,
  type TestBrowserHost,
} from "@kb/ui-test-kit";
import { matchSync } from "./routes";
import { SyncPage } from "./sync-page";

interface Call {
  readonly id: string;
  readonly input: Record<string, unknown>;
}
type Props = Record<string, PropValue[]>;
const ref = (v: string): PropValue => ({ t: "ref", v });
const str = (v: string): PropValue => ({ t: "str", v });

function outline(id: string, text: string, props: Props): OutlineNode {
  return {
    id,
    text,
    parentId: null,
    children: [],
    collapsed: false,
    props,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    tags: [],
  };
}
const account = (props: Props = {}) =>
  outline("acct", "Google Calendar", { [SYSTEM_IDS.typeField]: [ref(T.account)], ...props });
const confirmed = (...steps: string[]) => ({
  [F.project]: [str("kb-routines-me")],
  [F.setup]: steps.map((step) => ref(routineOption("setup", step))),
});

let dom: InstalledDom;
let root: Root;
let host: TestBrowserHost;
let graph: Map<string, OutlineNode>;
let calls: Call[];
let trusted: string[];
let answers: Record<string, ActionReceipt>;
const INFO = {
  redirectUri: "https://kb.test/calendar/connect",
  origin: "https://kb.test",
  store: "encrypted with systemd-creds",
  automation: { installed: false, account: null },
};
const ok = (id: string, output: unknown): ActionReceipt => ({ status: "succeeded", id, output });

function apply({ id, input }: Call): void {
  const nodeId = String(input["id"]);
  const props: Props = { ...graph.get(nodeId)?.props };
  for (const { field } of (input["unsetProps"] ?? []) as { field: string }[]) delete props[field];
  for (const { field, value } of [
    ...((input["props"] ?? []) as { field: string; value: PropValue }[]),
    ...((input["setProps"] ?? []) as { field: string; value: PropValue }[]),
  ])
    props[field] = [...(props[field] ?? []), value];
  const tags = (input["tags"] ?? []) as string[];
  if (tags.length > 0) props[SYSTEM_IDS.typeField] = tags.map(ref);
  if (id === "node.delete") graph.delete(nodeId);
  else
    graph.set(
      nodeId,
      outline(nodeId, typeof input["text"] === "string" ? input["text"] : "", props),
    );
}

function Routed() {
  const path = useSyncExternalStore(subscribePath, getPath);
  const params = useMemo(() => matchSync(path) ?? {}, [path]);
  return <SyncPage params={params} />;
}

beforeAll(() => {
  dom = installDomGlobals("https://kb.test/");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  setToastSink(() => undefined);
});
afterAll(() => dom.restore());
beforeEach(() => {
  calls = [];
  trusted = [];
  answers = {
    "ext.routines.setup": ok("ext.routines.setup", INFO),
    "ext.routines.binding": ok("ext.routines.binding", { digest: "sha256:acct" }),
    "ext.routines.connect": ok("ext.routines.connect", {
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=s",
    }),
  };
  const base = testBrowserHost();
  host = testBrowserHost({
    invoke: (id, input) => {
      const call = { id, input: input as Record<string, unknown> };
      calls.push(call);
      if (id.startsWith("node.")) {
        apply(call);
        host.setNodes(graph.values());
      }
      return Promise.resolve(answers[id] ?? ok(id, { ok: true }));
    },
    sandbox: {
      ...base.sandbox,
      setTrusted: (digest) => {
        trusted.push(digest);
        return Promise.resolve(ok("sandbox.trust", { digest, trusted: true }));
      },
    },
  });
  act(() => syncUiPlugins([testHostPlugin(host)]));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  act(() => syncUiPlugins([]));
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await act(() => Promise.resolve());
}
async function open(path: string, nodes: readonly OutlineNode[]): Promise<void> {
  graph = new Map(nodes.map((node) => [node.id, node]));
  act(() => host.setNodes(graph.values()));
  window.history.pushState({}, "", path);
  act(() => root.render(<Routed />));
  await settle();
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (each) => each.textContent.trim() === name || each.getAttribute("aria-label") === name,
  );
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}
async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
  await settle();
}
/** Type into the input labelled `label`, as a person does. */
function fill(label: string, value: string): void {
  const field = [...document.querySelectorAll("label")].find((each) =>
    each.textContent.startsWith(label),
  );
  const input = field?.querySelector("input");
  if (input === null || input === undefined) throw new Error(`no field ${label}`);
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "e" }));
  });
}
const text = () => document.body.textContent;
const setupCurrent = () =>
  document.querySelector("[data-setup-current]")?.getAttribute("data-setup-current");

describe("sync services", () => {
  test("Add sync service → Google makes one account node and opens its setup at step 1", async () => {
    await open("/calendar/sync", []);
    expect(text()).toContain("No sync service yet.");
    await click(button("Add sync service"));
    await click(document.querySelector('[data-provider="google"]') ?? document.body);
    const add = calls.find((call) => call.id === "node.add");
    expect(add?.input["tags"]).toEqual([T.account]);
    expect(getPath()).toBe(`/calendar/sync/${String(add?.input["id"])}`);
    expect(setupCurrent()).toBe("project");
    expect(document.querySelector('[aria-current="step"]')?.getAttribute("data-setup-step")).toBe(
      "project",
    );
    // Later steps wait: nothing past the project can be opened yet.
    expect(document.querySelector<HTMLButtonElement>('[data-setup-step="client"]')?.disabled).toBe(
      true,
    );
  });

  test("a confirmed step is saved on the account, and the wizard resumes at the next", async () => {
    await open("/calendar/sync/acct", [account(confirmed("project"))]);
    expect(setupCurrent()).toBe("apis");
    const link = [...document.querySelectorAll("a")].find((each) =>
      each.href.includes("calendar-json.googleapis.com"),
    );
    expect(link?.href).toBe(
      "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=kb-routines-me",
    );
    expect(link?.target).toBe("_blank");
    await click(button("It's enabled"));
    const update = calls.find((call) => call.id === "node.update");
    // The whole set of confirmations is written: the project kept, the API added.
    expect(update?.input["setProps"]).toEqual([
      { field: F.setup, value: ref(routineOption("setup", "project")) },
      { field: F.setup, value: ref(routineOption("setup", "apis")) },
    ]);
    // Leave and come back: the page reads where the person is from the account alone.
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await open("/calendar/sync/acct", [...graph.values()]);
    expect(setupCurrent()).toBe("branding");
  });

  test("a project the person already has skips to the client, which asks for kb's URI on its client", async () => {
    await open("/calendar/sync/acct", [account()]);
    expect(setupCurrent()).toBe("project");
    const existing = [...document.querySelectorAll("label")].find((each) =>
      each.textContent.startsWith("Use a project I already have"),
    );
    await click(existing?.querySelector("input") ?? document.body);
    fill("Project ID", "tanaint-ops");
    await click(button("Use tanaint-ops"));
    expect(calls.find((call) => call.id === "node.update")?.input["setProps"]).toEqual([
      { field: F.project, value: str("tanaint-ops") },
      ...["project", "existing"].map((step) => ({
        field: F.setup,
        value: ref(routineOption("setup", step)),
      })),
    ]);
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await open("/calendar/sync/acct", [...graph.values()]);
    expect(setupCurrent()).toBe("client");
    expect(text()).toContain("Add kb to your OAuth client");
    expect(document.querySelector("[data-copy-value]")?.textContent).toBe(INFO.redirectUri);
  });

  test("an account past the consent screen resumes at the Branding page, with text for its pages", async () => {
    await open("/calendar/sync/acct", [account(confirmed("project", "apis", "branding"))]);
    expect(setupCurrent()).toBe("domain");
    expect(
      [...document.querySelectorAll("a")].some(
        (each) =>
          each.href === "https://console.cloud.google.com/auth/branding?project=kb-routines-me",
      ),
    ).toBe(true);
    expect(text()).toContain("Leave App logo empty");
    const copied = [...document.querySelectorAll("[data-copy-value]")].map(
      (each) => each.textContent,
    );
    expect(copied.some((each) => each.startsWith("Privacy policy for kb routines"))).toBe(true);
    await click(button("The Branding page is filled in"));
    expect(calls.find((call) => call.id === "node.update")?.input["setProps"]).toEqual(
      ["project", "apis", "branding", "domain"].map((step) => ({
        field: F.setup,
        value: ref(routineOption("setup", step)),
      })),
    );
  });

  test("the client step shows the exact redirect URI to copy, and Google's verdict on a client", async () => {
    await open("/calendar/sync/acct", [
      account(confirmed("project", "apis", "branding", "audience")),
    ]);
    expect(setupCurrent()).toBe("client");
    expect(document.querySelector("[data-copy-value]")?.textContent).toBe(INFO.redirectUri);
    answers["ext.routines.client"] = {
      status: "failed",
      id: "ext.routines.client",
      code: "internal",
      message: "client_invalid",
    };
    fill("Client ID", "1-a.apps.googleusercontent.com");
    fill("Client secret", "GOCSPX-typed");
    await click(button("Check with Google and save"));
    expect(calls.find((call) => call.id === "ext.routines.client")?.input).toEqual({
      account: "acct",
      clientId: "1-a.apps.googleusercontent.com",
      clientSecret: "GOCSPX-typed",
    });
    expect(text()).toContain("Google doesn't recognise this client ID and secret.");
    answers["ext.routines.client"] = ok("ext.routines.client", { ok: true });
    await click(button("Check with Google and save"));
    expect(text()).toContain("Google accepted this client.");
    // The secret leaves the field once kept: the page holds it no longer than the call.
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
  });

  test("Connect trusts the account's binding as the person, then goes to Google", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    await open("/calendar/sync/acct", [
      account({
        ...confirmed("project", "apis", "branding", "audience"),
        [F.clientId]: [str("sealed:routines.acct.client-id")],
        [F.clientSecret]: [str("sealed:routines.acct.client-secret")],
      }),
    ]);
    expect(setupCurrent()).toBe("connect");
    await click(button("Connect with Google"));
    expect(trusted).toEqual(["sha256:acct"]);
    expect(calls.map((call) => call.id).filter((id) => id.startsWith("ext."))).toEqual([
      "ext.routines.setup",
      "ext.routines.binding",
      "ext.routines.connect",
    ]);
    expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=s");
  });

  test("Google's answer goes to the host once, leaves the address bar, and returns to the setup", async () => {
    answers["ext.routines.finish"] = ok("ext.routines.finish", { account: "acct" });
    await open("/calendar/connect?state=s&code=one-shot", [
      account({ [F.status]: [ref(routineOption("status", "synced"))] }),
    ]);
    const finish = calls.filter((call) => call.id === "ext.routines.finish");
    expect(finish).toEqual([
      {
        id: "ext.routines.finish",
        input: { redirect: "https://kb.test/calendar/connect?state=s&code=one-shot" },
      },
    ]);
    expect(window.location.search).toBe("");
    expect(getPath()).toBe("/calendar/sync/acct");
  });

  test("a refused answer says why, in words", async () => {
    answers["ext.routines.finish"] = {
      status: "failed",
      id: "ext.routines.finish",
      code: "internal",
      message: "consent_denied",
    };
    await open("/calendar/connect?state=s&error=access_denied", []);
    expect(text()).toContain("The Google sign-in was cancelled.");
    expect(button("Back to sync services")).toBeDefined();
  });
});
