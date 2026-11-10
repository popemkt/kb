/**
 * Setting up a sync service: the steps a person walks to connect an account
 * (a `#google-account` node) to Google, as a state machine over that node's
 * own fields. Nothing stands beside the graph: where a person is in the
 * wizard is read from the account and the calendars linked to it each time,
 * so leaving and coming back resumes where the data says, in this kb.
 *
 * - The steps kb cannot see in Google before it holds credentials (the
 *   project, its APIs, its consent screen, its Branding page and its
 *   audience) are the person's own word, kept as the account's `setup done`
 *   options. Naming another project takes that word back, since it was
 *   about the old one. One word can vouch for others ({@link confirmedBy}):
 *   publishing needs a complete Branding page, so a publish confirmed
 *   counts that page done too, and an account that published before the
 *   step was listed keeps its place; a project the person already had
 *   (`existing`) is set up and published, so it counts every step up to the
 *   client done.
 * - The client is done when the account names its client id and secret,
 *   which the host writes only after Google accepted them.
 * - Connected is the account's own sync status, which the host writes when
 *   Google hands it a refresh token.
 * - Calendars is done when a calendar on this account is synced to Google.
 */
import { firstRef, firstStr, typeRefsOf, type NodeLike } from "@kb/model";
import { updateNode, type NodeCall } from "./calendar-edits.ts";
import { readCalendar } from "./config.ts";
import {
  optionsFor,
  readRoutineOption,
  routineOption,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type RoutineOption,
} from "./seed.ts";

/** The steps, in order. */
export const SETUP_STEPS = [
  "project",
  "apis",
  "branding",
  "domain",
  "audience",
  "client",
  "connect",
  "calendars",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
/** What a person confirms by hand: a step, or that the project is one they already had. */
export type ConfirmedStep = RoutineOption<"setup">;
export const CONFIRMED_STEPS: readonly ConfirmedStep[] = optionsFor("setup");

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens, from a letter. */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A calendar on the account, as the last step lists it. */
export interface SetupCalendar {
  readonly id: string;
  readonly name: string;
  readonly mode: string;
  /** Whether its Google calendar exists: kb made it and wrote its id. */
  readonly provisioned: boolean;
}

/** What the wizard reads of an account. */
export interface AccountSetup {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly project: string;
  readonly confirmed: ReadonlySet<ConfirmedStep>;
  readonly credentials: boolean;
  readonly connected: boolean;
  /** Why the account cannot sync, as the host last said; empty when it can. */
  readonly problem: string;
  readonly calendars: readonly SetupCalendar[];
}

export function readAccountSetup(
  account: NodeLike,
  nodes: ReadonlyMap<string, NodeLike>,
): AccountSetup {
  const confirmed = new Set<ConfirmedStep>();
  for (const value of account.props[F.setup] ?? []) {
    const step = value.t === "ref" ? readRoutineOption("setup", value.v) : undefined;
    if (step !== undefined) confirmed.add(step);
  }
  const status = readRoutineOption("status", firstRef(F.status)(account.props));
  const calendars: SetupCalendar[] = [];
  for (const node of nodes.values()) {
    if (!typeRefsOf(node).includes(T.calendar)) continue;
    if (firstRef(F.account)(node.props) !== account.id) continue;
    let read = { mode: "invalid", calendarId: "" };
    try {
      read = readCalendar(node);
    } catch {
      // A calendar the engine cannot read is still listed, as not provisioned.
    }
    calendars.push({
      id: node.id,
      name: node.text === "" ? "Untitled calendar" : node.text,
      mode: read.mode,
      provisioned: read.calendarId !== "",
    });
  }
  const text = (field: string) => firstStr(field)(account.props) ?? "";
  return {
    id: account.id,
    name: account.text,
    email: text(F.email),
    project: text(F.project),
    confirmed,
    credentials: text(F.clientId) !== "" && text(F.clientSecret) !== "",
    connected: status === "synced",
    problem: status === "error" ? text(F.message) || "Google refused the connection" : "",
    calendars: calendars.toSorted((a, b) => a.id.localeCompare(b.id)),
  };
}

/** What else a confirmation vouches for, beyond itself. */
const COVERS: Readonly<Partial<Record<ConfirmedStep, readonly ConfirmedStep[]>>> = {
  audience: ["domain"],
  existing: ["apis", "branding", "domain", "audience"],
};

/** The confirmation that makes `step` confirmed: its own, one that vouches for it, or null. */
export function confirmedBy(setup: AccountSetup, step: ConfirmedStep): ConfirmedStep | null {
  if (setup.confirmed.has(step)) return step;
  return (
    CONFIRMED_STEPS.find(
      (each) => setup.confirmed.has(each) && (COVERS[each]?.includes(step) ?? false),
    ) ?? null
  );
}

const held = (step: ConfirmedStep) => (setup: AccountSetup) => confirmedBy(setup, step) !== null;

/** What makes each step done, as the account says. */
const DONE: Readonly<Record<SetupStep, (setup: AccountSetup) => boolean>> = {
  project: (setup) => setup.project !== "" && held("project")(setup),
  apis: held("apis"),
  branding: held("branding"),
  domain: held("domain"),
  audience: held("audience"),
  client: (setup) => setup.credentials,
  connect: (setup) => setup.connected,
  calendars: (setup) =>
    setup.calendars.some((calendar) => calendar.provisioned && calendar.mode === "on"),
};

/** Whether `step` is done, as the account says. */
export function stepDone(setup: AccountSetup, step: SetupStep): boolean {
  return DONE[step](setup);
}

/** The step to resume at: the first not done, or `done` when every one is. */
export function currentStep(setup: AccountSetup): SetupStep | "done" {
  return SETUP_STEPS.find((step) => !stepDone(setup, step)) ?? "done";
}

/**
 * Whether `step` may be opened: a step done, or the one to resume at. A
 * later step waits for what it needs (a client needs the project its links
 * open; connecting needs the client), so it is never reached by skipping.
 */
export function stepOpen(setup: AccountSetup, step: SetupStep): boolean {
  const current = currentStep(setup);
  return (
    current === "done" ||
    stepDone(setup, step) ||
    SETUP_STEPS.indexOf(step) <= SETUP_STEPS.indexOf(current)
  );
}

/** A new sync service: one account node, named for its provider. */
export function addAccount(id: string, name: string): NodeCall {
  return { id: "node.add", input: { id, text: name, tags: [T.account] } };
}

const confirmations = (steps: Iterable<ConfirmedStep>) =>
  [...steps].map((step) => ({ t: "ref" as const, v: routineOption("setup", step) }));

/** Where the account's project came from: made for kb, or one the person already had. */
export type ProjectSource = "new" | "existing";

export function projectSource(setup: AccountSetup): ProjectSource {
  return setup.confirmed.has("existing") ? "existing" : "new";
}

/**
 * Name the account's project, confirm it, and say where it came from.
 * Another project than the one named takes back every step confirmed about
 * the old one.
 */
export function chooseProject(
  setup: AccountSetup,
  project: string,
  source: ProjectSource,
): NodeCall {
  const next = new Set<ConfirmedStep>(setup.project === project ? setup.confirmed : []);
  next.add("project");
  if (source === "existing") next.add("existing");
  else next.delete("existing");
  return updateNode(setup.id, {
    [F.project]: [{ t: "str", v: project }],
    [F.setup]: confirmations(CONFIRMED_STEPS.filter((each) => next.has(each))),
  });
}

/** Confirm a step by hand, or take that back. */
export function confirmStep(setup: AccountSetup, step: ConfirmedStep, done: boolean): NodeCall {
  const next = new Set(setup.confirmed);
  if (done) next.add(step);
  else next.delete(step);
  return updateNode(setup.id, {
    [F.setup]: confirmations(CONFIRMED_STEPS.filter((each) => next.has(each))),
  });
}

/** Set the account's email, a label and the hint Google's sign-in opens with. */
export function setAccountEmail(setup: AccountSetup, email: string): NodeCall {
  return updateNode(setup.id, { [F.email]: email === "" ? [] : [{ t: "str", v: email }] });
}

/** A new calendar on the account: held in preview until its Google calendar exists. */
export function addSetupCalendar(
  id: string,
  account: string,
  name: string,
  zone: string,
): NodeCall {
  return {
    id: "node.add",
    input: {
      id,
      text: name,
      tags: [T.calendar],
      props: [
        { field: F.account, value: { t: "ref", v: account } },
        { field: F.adapter, value: { t: "ref", v: routineOption("adapter", "google") } },
        { field: F.timezone, value: { t: "str", v: zone } },
        { field: F.sync, value: { t: "ref", v: routineOption("sync", "preview") } },
      ],
    },
  };
}

/** Put a calendar on the account, held in preview until its Google calendar exists. */
export function linkCalendar(calendar: string, account: string): NodeCall {
  return updateNode(calendar, {
    [F.account]: [{ t: "ref", v: account }],
    [F.adapter]: [{ t: "ref", v: routineOption("adapter", "google") }],
  });
}

/** Set whether a calendar sends to Google. */
export function setCalendarSync(calendar: string, mode: RoutineOption<"sync">): NodeCall {
  return updateNode(calendar, { [F.sync]: [{ t: "ref", v: routineOption("sync", mode) }] });
}
