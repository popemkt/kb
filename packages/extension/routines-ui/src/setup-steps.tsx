/**
 * The body of each Google setup step: what to open (a Console page with the
 * project already chosen), what the person will see there, and the check
 * kb makes or the confirmation the person gives. Every write goes through
 * the page's invoke path: node calls from `@kb/routines` → setup.ts, and the
 * host's `ext.routines.*` actions, which only a person may make.
 */
import { useState, type ComponentType, type ReactNode } from "react";
import { Schema } from "effect";
import {
  addSetupCalendar,
  chooseProject,
  confirmedBy,
  confirmStep,
  linkCalendar,
  PROJECT_ID,
  projectSource,
  readCalendar,
  ROUTINE_TAGS,
  setAccountEmail,
  setCalendarSync,
  type AccountSetup,
  type ConfirmedStep,
  type ProjectSource,
} from "@kb/routines";
import { nodesOfKind } from "@kb/model";
import { cn, useNodes } from "@kb/ui-sdk";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./dialog";
import { FIELD_CLASS } from "./repeat-picker";
import {
  consolePage,
  consoleUrl,
  provisionCalendar,
  setupCall,
  startConnect,
  type SetupInfo,
} from "./setup-calls.ts";
import { ExistingClientGuide, ExistingProject, SourceChoice } from "./setup-existing";
import { ConsoleLink, CopyValue, Field, Pick, StepFrame, Verdict, WhatYouSee } from "./setup-parts";
import { mintId, runCalls } from "./writes";

/** A project id to suggest: valid, and unlikely to be taken. */
function suggestedProject(): string {
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) =>
    (byte % 36).toString(36),
  ).join("");
  return `kb-routines-${tail}`;
}

/** What every step body is handed. */
export interface StepProps {
  readonly setup: AccountSetup;
  readonly info: SetupInfo | null;
  readonly index: number;
}

/** A busy flag and the last error, for one step's one action. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      setError(await work());
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Why a step is done when another confirmation vouches for it. */
const COVERED: Partial<Record<ConfirmedStep, string>> = {
  audience: "Done: the app is published, so its Branding page is complete.",
  existing: "Done: your project was set up before. Step 1 says which project.",
};

/** The button that confirms a step done by hand, or takes it back; or why it is done already. */
export function Confirm({
  setup,
  step,
  children,
}: {
  readonly setup: AccountSetup;
  readonly step: ConfirmedStep;
  readonly children: ReactNode;
}) {
  const by = confirmedBy(setup, step);
  if (by !== null && by !== step) return <Verdict tone="ok">{COVERED[by] ?? "Done."}</Verdict>;
  const done = by === step;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {done ? (
        <>
          <Verdict tone="ok">Done.</Verdict>
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => void runCalls([confirmStep(setup, step, false)], "Could not undo it")}
          >
            Not yet
          </button>
        </>
      ) : (
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASS}
          onClick={() => void runCalls([confirmStep(setup, step, true)], "Could not save it")}
        >
          {children}
        </button>
      )}
    </div>
  );
}

export function ProjectStep({ setup, info, index }: StepProps) {
  const [source, setSource] = useState<ProjectSource>(() => projectSource(setup));
  return (
    <StepFrame
      index={index}
      title="Choose a Google Cloud project"
      why="Your own project holds the OAuth client kb signs in with, so nobody else's app touches your calendar."
    >
      <SourceChoice value={source} onChange={setSource} />
      {source === "new" ? (
        <NewProject setup={setup} info={info} />
      ) : (
        <ExistingProject setup={setup} />
      )}
    </StepFrame>
  );
}

/** Step 1 for a project made for kb: its id, made by gcloud or in the Console. */
function NewProject({ setup, info }: Omit<StepProps, "index">) {
  const [project, setProject] = useState(() => setup.project || suggestedProject());
  const action = useAction();
  const valid = PROJECT_ID.test(project);
  const gcloud = info?.automation;
  const automate = () =>
    action.run(async () => {
      const done = await setupCall("automate", { project }, Schema.Unknown);
      if (!done.ok) return done.error;
      const saved = await runCalls(
        [chooseProject(setup, project, "new")],
        "Could not save the project",
      );
      if (!saved) return null;
      const next = { ...setup, project, confirmed: new Set<ConfirmedStep>(["project"]) };
      await runCalls([confirmStep(next, "apis", true)], "Could not save it");
      return null;
    });
  return (
    <>
      <Field
        label="Project ID"
        hint="6–30 lowercase letters, digits or hyphens, starting with a letter. It can't be changed later."
      >
        <input
          className={cn(FIELD_CLASS, "font-mono")}
          value={project}
          spellCheck={false}
          aria-invalid={!valid}
          onChange={(event) => setProject(event.target.value.trim().toLowerCase())}
        />
      </Field>
      {gcloud?.installed === true && gcloud.account !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-ui text-foreground">
            kb's host has the Google Cloud CLI signed in as <Pick>{gcloud.account}</Pick>. kb can
            create the project and enable the Calendar API for you (steps 1–2).
          </p>
          <button
            type="button"
            className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
            disabled={!valid || action.busy}
            onClick={() => void automate()}
          >
            {action.busy ? "Working with gcloud…" : "Do steps 1–2 for me"}
          </button>
        </div>
      ) : (
        <Verdict tone="note">
          {gcloud?.installed === true
            ? "gcloud is on kb's host but not signed in. Run gcloud auth login there and reopen this step to have kb do steps 1–2 for you."
            : "With the Google Cloud CLI signed in on kb's host, kb could do steps 1–2 for you. Without it, follow the link below."}
        </Verdict>
      )}
      {action.error === null ? null : <Verdict tone="error">{action.error}</Verdict>}
      <ConsoleLink href={consoleUrl("projectcreate")}>Open New Project in the Console</ConsoleLink>
      <CopyValue label="Project ID" value={project} />
      <WhatYouSee>
        <li>
          A <Pick>New Project</Pick> form. Name it anything, for example “kb routines”.
        </li>
        <li>
          Under the name, press <Pick>Edit</Pick> next to the project ID and paste the ID above.
        </li>
        <li>
          Leave the organization as <Pick>No organization</Pick> and press <Pick>Create</Pick>.
          Creating takes about half a minute.
        </li>
      </WhatYouSee>
      <button
        type="button"
        className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
        disabled={!valid}
        onClick={() => void runCalls([chooseProject(setup, project, "new")], "Could not save it")}
      >
        {setup.project === project && projectSource(setup) === "new"
          ? "Saved"
          : `I created ${valid ? project : "it"}`}
      </button>
    </>
  );
}

export function ApisStep({ setup, index }: StepProps) {
  return (
    <StepFrame
      index={index}
      title="Enable the Google Calendar API"
      why="kb writes your events to Google Calendar through this API. Projects start with it switched off."
    >
      <ConsoleLink href={consolePage("apis/library/calendar-json.googleapis.com", setup.project)}>
        Open Google Calendar API
      </ConsoleLink>
      <WhatYouSee>
        <li>
          The <Pick>Google Calendar API</Pick> page, with <Pick>{setup.project}</Pick> chosen at the
          top.
        </li>
        <li>
          Press <Pick>Enable</Pick>. When it's on, the page shows <Pick>API Enabled</Pick> or offers{" "}
          <Pick>Manage</Pick> instead.
        </li>
      </WhatYouSee>
      <Confirm setup={setup} step="apis">
        It's enabled
      </Confirm>
    </StepFrame>
  );
}

export function BrandingStep({ setup, index }: StepProps) {
  return (
    <StepFrame
      index={index}
      title="Set up the consent screen"
      why="Google shows this screen when you connect. It needs a name and your email address."
    >
      <ConsoleLink href={consolePage("auth/branding", setup.project)}>
        Open Google Auth Platform
      </ConsoleLink>
      <CopyValue label="App name" value="kb routines" />
      <WhatYouSee>
        <li>
          <Pick>Google Auth Platform not configured yet</Pick>. Press <Pick>Get started</Pick>.
        </li>
        <li>
          <Pick>App information</Pick>: the app name above, and your email as the user support
          email.
        </li>
        <li>
          <Pick>Audience</Pick>: choose <Pick>External</Pick>, which lets your own Google account
          use it.
        </li>
        <li>
          <Pick>Contact information</Pick>: your email. At <Pick>Finish</Pick>, tick the agreement
          to the Google API Services User Data Policy, press <Pick>Continue</Pick>, then{" "}
          <Pick>Create</Pick>.
        </li>
      </WhatYouSee>
      <Confirm setup={setup} step="branding">
        The consent screen is set up
      </Confirm>
    </StepFrame>
  );
}

export function AudienceStep({ setup, index }: StepProps) {
  return (
    <StepFrame
      index={index}
      title="Publish the app to production"
      why={
        <>
          While an External app is in Testing,{" "}
          <a
            className="text-primary hover:underline"
            href="https://support.google.com/cloud/answer/15549945"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google ends its connections after 7 days
          </a>
          . In production the connection lasts.
        </>
      }
    >
      <ConsoleLink href={consolePage("auth/audience", setup.project)}>Open Audience</ConsoleLink>
      <WhatYouSee>
        <li>
          <Pick>Publishing status: Testing</Pick>. Press <Pick>Publish app</Pick>, then{" "}
          <Pick>Confirm</Pick>. If it's greyed out and asks you to complete the Branding page, go
          back to step {index - 1}.
        </li>
        <li>
          The status reads <Pick>In production</Pick>. Google may say the app needs verification. An
          app only you use doesn't, so leave it unverified.
        </li>
        <li>
          When you connect, Google warns <Pick>Google hasn't verified this app</Pick>. That's this
          app, your own. Choose <Pick>Advanced</Pick>, then <Pick>Go to kb routines</Pick>.
        </li>
      </WhatYouSee>
      <Confirm setup={setup} step="audience">
        It's in production
      </Confirm>
    </StepFrame>
  );
}

/** The client step's guide for a project made for kb: a new client. */
function NewClientGuide({ setup }: { readonly setup: AccountSetup }) {
  return (
    <>
      <ConsoleLink href={consolePage("auth/clients/create", setup.project)}>
        Open Create OAuth client
      </ConsoleLink>
      <WhatYouSee>
        <li>
          <Pick>Application type</Pick>: choose <Pick>Web application</Pick>. Name it “kb routines”.
        </li>
        <li>
          Under <Pick>Authorized redirect URIs</Pick>, press <Pick>Add URI</Pick> and paste the URI
          below exactly. Then press <Pick>Create</Pick>.
        </li>
        <li>
          A dialog shows the <Pick>Client ID</Pick> and the <Pick>Client secret</Pick>. Copy both
          now, because Google won't show the secret again. Download the JSON if you want a copy.
        </li>
      </WhatYouSee>
    </>
  );
}

/** The client step, by where the project came from: a new client, or kb added to one it has. */
const CLIENT_GUIDES: Readonly<
  Record<
    ProjectSource,
    {
      readonly title: string;
      readonly Guide: ComponentType<{ readonly setup: AccountSetup }>;
    }
  >
> = {
  new: { title: "Create the OAuth client", Guide: NewClientGuide },
  existing: { title: "Add kb to your OAuth client", Guide: ExistingClientGuide },
};

export function ClientStep({ setup, info, index }: StepProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const elsewhere = info !== null && window.location.origin !== info.origin;
  const save = () =>
    action.run(async () => {
      setSaved(false);
      const done = await setupCall(
        "client",
        { account: setup.id, clientId, clientSecret },
        Schema.Unknown,
      );
      if (!done.ok) return done.error;
      setClientSecret("");
      setSaved(true);
      return null;
    });
  const guide = CLIENT_GUIDES[projectSource(setup)];
  return (
    <StepFrame
      index={index}
      title={guide.title}
      why="The client is how kb asks Google for access. You paste its ID and secret here, and kb checks them with Google before keeping them."
    >
      <guide.Guide setup={setup} />
      <div className="flex flex-col gap-1">
        <span className="text-label text-muted-foreground">Authorized redirect URI</span>
        {info === null ? (
          <span className="text-meta text-muted-foreground">Asking kb's host…</span>
        ) : (
          <CopyValue label="Redirect URI" value={info.redirectUri} />
        )}
        {elsewhere ? (
          <Verdict tone="note">
            You opened kb at {window.location.origin}, but Google will send you back to{" "}
            {info.origin}, kb's public address. Start kb with the public origin you use, or open it
            there.
          </Verdict>
        ) : null}
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Client ID">
          <input
            className={cn(FIELD_CLASS, "font-mono")}
            value={clientId}
            spellCheck={false}
            autoComplete="off"
            placeholder="1234567890-abc….apps.googleusercontent.com"
            onChange={(event) => setClientId(event.target.value)}
          />
        </Field>
        <Field
          label="Client secret"
          hint={`Sent once to kb's host, checked with Google, then kept ${info?.store ?? "on the host"}. This page never shows it again.`}
        >
          <input
            className={cn(FIELD_CLASS, "font-mono")}
            type="password"
            value={clientSecret}
            spellCheck={false}
            autoComplete="off"
            placeholder={setup.credentials ? "Saved. Paste a new one to replace it" : "GOCSPX-…"}
            onChange={(event) => setClientSecret(event.target.value)}
          />
        </Field>
        <button
          type="submit"
          className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
          disabled={action.busy || clientId.trim() === "" || clientSecret.trim() === ""}
        >
          {action.busy ? "Checking with Google…" : "Check with Google and save"}
        </button>
      </form>
      {action.error === null ? null : <Verdict tone="error">{action.error}</Verdict>}
      {saved || (setup.credentials && action.error === null) ? (
        <Verdict tone="ok">
          Google accepted this client. Its ID and secret are kept {info?.store ?? "on kb's host"}.
        </Verdict>
      ) : null}
    </StepFrame>
  );
}

export function ConnectStep({ setup, info, index }: StepProps) {
  const [email, setEmail] = useState(setup.email);
  const action = useAction();
  const connect = () =>
    action.run(async () => {
      if (email !== setup.email)
        await runCalls([setAccountEmail(setup, email.trim())], "Could not save the email");
      return startConnect(setup.id);
    });
  return (
    <StepFrame
      index={index}
      title="Connect with Google"
      why="Google asks you to let kb manage calendars it creates. kb asks for nothing else: it can't see or change your other calendars."
    >
      <Field label="Google account (optional)" hint="Google's sign-in opens on this account.">
        <input
          className={FIELD_CLASS}
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@gmail.com"
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <WhatYouSee>
        <li>Google's sign-in, then a warning that Google hasn't verified this app.</li>
        <li>
          Choose <Pick>Advanced</Pick>, then <Pick>Go to kb routines (unsafe)</Pick>. It's your own
          app.
        </li>
        <li>
          Allow kb to <Pick>see, edit… calendars it creates</Pick>. Google then sends you back here.
        </li>
      </WhatYouSee>
      <Verdict tone="note">
        Pressing Connect also lets this host use the client and the token kept{" "}
        {info?.store ?? "on it"} for this account. Google's answer comes back to kb's host and stays
        there.
      </Verdict>
      {setup.problem === "" ? null : <Verdict tone="error">{setup.problem}</Verdict>}
      {setup.connected ? <Verdict tone="ok">Connected to Google.</Verdict> : null}
      <button
        type="button"
        className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
        disabled={action.busy}
        onClick={() => void connect()}
      >
        {action.busy ? "Opening Google…" : setup.connected ? "Reconnect" : "Connect with Google"}
      </button>
      {action.error === null ? null : <Verdict tone="error">{action.error}</Verdict>}
      <p className="text-meta text-muted-foreground">
        Google shows <Pick>Error 400: redirect_uri_mismatch</Pick>? The client in step 5 must list
        exactly {info?.redirectUri ?? "kb's redirect URI"}.
      </p>
    </StepFrame>
  );
}

/** Put one calendar on Google: link it to the account, create its Google calendar, sync it. */
async function syncCalendar(setup: AccountSetup, calendar: string): Promise<string | null> {
  if (!(await runCalls([linkCalendar(calendar, setup.id)], "Could not link the calendar")))
    return "Could not link the calendar.";
  const made = await provisionCalendar(calendar);
  if (made !== null) return made;
  return (await runCalls([setCalendarSync(calendar, "on")], "Could not turn sync on"))
    ? null
    : "Could not turn sync on.";
}

/** Sync `calendars` one after another, telling `progress` each answer as it comes. */
async function syncEach(
  setup: AccountSetup,
  calendars: readonly string[],
  progress: (calendar: string, error: string | null) => void,
): Promise<boolean> {
  const [calendar, ...rest] = calendars;
  if (calendar === undefined) return true;
  const error = await syncCalendar(setup, calendar);
  progress(calendar, error);
  return (await syncEach(setup, rest, progress)) && error === null;
}

export function CalendarsStep({ setup, index }: StepProps) {
  const nodes = useNodes();
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calendars = nodesOfKind(nodes, ROUTINE_TAGS.calendar)
    .map((node) => {
      let read = { account: "", calendarId: "", mode: "invalid" };
      try {
        read = readCalendar(node);
      } catch {
        // Listed anyway; picking it rewrites its account and adapter.
      }
      return { id: node.id, name: node.text || "Untitled calendar", ...read };
    })
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(calendars.filter((calendar) => calendar.account === setup.id).map((c) => c.id)),
  );
  const [fresh, setFresh] = useState(calendars.length === 0 ? "Events" : "");
  const [results, setResults] = useState<ReadonlyMap<string, string | null>>(new Map());
  const action = useAction();
  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sync = () =>
    action.run(async () => {
      const chosen = [...picked];
      if (fresh.trim() !== "") {
        const id = mintId();
        if (
          !(await runCalls(
            [addSetupCalendar(id, setup.id, fresh.trim(), zone)],
            "Could not add it",
          ))
        )
          return "Could not add the new calendar.";
        chosen.push(id);
        setFresh("");
      }
      const answers = new Map<string, string | null>();
      const all = await syncEach(setup, chosen, (calendar, error) => {
        answers.set(calendar, error);
        setResults(new Map(answers));
      });
      return all ? null : "Some calendars didn't sync. Each one says why.";
    });
  return (
    <StepFrame
      index={index}
      title="Pick calendars to sync"
      why="Each kb calendar becomes a calendar of its own in your Google account, created by kb. Your other Google calendars stay untouched."
    >
      {calendars.length === 0 ? null : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-label text-muted-foreground">kb calendars</legend>
          {calendars.map((calendar) => {
            const result = results.get(calendar.id);
            const synced =
              calendar.account === setup.id && calendar.calendarId !== "" && calendar.mode === "on";
            return (
              <div
                key={calendar.id}
                className="flex flex-col gap-1 rounded-md border border-border p-2"
              >
                <label className="flex items-center gap-2 text-ui text-foreground">
                  <input
                    type="checkbox"
                    checked={picked.has(calendar.id)}
                    onChange={() => toggle(calendar.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                  <span className="text-meta text-muted-foreground">
                    {synced
                      ? "Syncing"
                      : calendar.account !== "" && calendar.account !== setup.id
                        ? "On another account"
                        : "Not synced"}
                  </span>
                </label>
                {result === undefined ? null : result === null ? (
                  <Verdict tone="ok">Synced to its own Google calendar.</Verdict>
                ) : (
                  <Verdict tone="error">{result}</Verdict>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      <Field label="New calendar" hint={`Optional. Its times are in ${zone}.`}>
        <input
          className={FIELD_CLASS}
          value={fresh}
          placeholder="Events"
          onChange={(event) => setFresh(event.target.value)}
        />
      </Field>
      <button
        type="button"
        className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
        disabled={action.busy || (picked.size === 0 && fresh.trim() === "")}
        onClick={() => void sync()}
      >
        {action.busy ? "Creating Google calendars…" : "Sync these calendars"}
      </button>
      {action.error === null ? null : <Verdict tone="error">{action.error}</Verdict>}
    </StepFrame>
  );
}
