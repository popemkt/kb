/**
 * The calendar's sync services (`/calendar/sync`): each service a
 * `#google-account` node, with how far its setup is; "Add sync service"
 * picks a provider and opens its setup (`/calendar/sync/<account>`). Google
 * sends the person back to `/calendar/connect`, which hands that URL to the
 * host to finish connecting and returns to the service's setup.
 */
import { useEffect, useRef, useState } from "react";
import { Schema } from "effect";
import { ArrowLeftIcon, CalendarDotsIcon, PlusIcon } from "@phosphor-icons/react";
import {
  addAccount,
  currentStep,
  readAccountSetup,
  ROUTINE_TAGS,
  SETUP_STEPS,
  stepDone,
  CONNECT_PATH,
  type SyncParams,
} from "@kb/routines";
import { nodesOfKind } from "@kb/model";
import { cn, navigate, toast, useNodes } from "@kb/ui-sdk";
import { BUTTON_CLASS, Dialog, PRIMARY_BUTTON_CLASS } from "./dialog";
import { CALENDAR_PATH, syncPath } from "./routes";
import { setupCall } from "./setup-calls";
import { Verdict } from "./setup-parts";
import { SetupWizard } from "./setup-wizard";
import { mintId, runCalls } from "./writes";

/** The providers a sync service can be; Google is the one there is. */
const PROVIDERS = [
  {
    id: "google",
    name: "Google Calendar",
    blurb:
      "Your events go to calendars kb creates in your Google account. About ten minutes to set up, with your own Google Cloud project.",
  },
] as const;

function ProviderPicker({ onClose }: { readonly onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const id = mintId();
    if (await runCalls([addAccount(id, "Google Calendar")], "Could not add it")) {
      onClose();
      navigate(syncPath(id));
    }
    setBusy(false);
  };
  return (
    <Dialog title="Add a sync service" onClose={onClose} testId="sync-provider-picker">
      <p className="text-ui text-muted-foreground">Where should kb send your events?</p>
      <div className="flex flex-col gap-2" role="list">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            role="listitem"
            disabled={busy}
            data-provider={provider.id}
            onClick={() => void add()}
            className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-accent/60"
          >
            <CalendarDotsIcon size={22} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            <span className="flex flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">{provider.name}</span>
              <span className="text-meta text-muted-foreground">{provider.blurb}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-meta text-muted-foreground">More providers can follow the same steps.</p>
    </Dialog>
  );
}

function ServiceList() {
  const nodes = useNodes();
  const [picking, setPicking] = useState(false);
  const services = nodesOfKind(nodes, ROUTINE_TAGS.account)
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map((node) => readAccountSetup(node, nodes));
  return (
    <div className="flex max-w-2xl flex-col gap-4" data-testid="routines-sync-services">
      {services.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-5">
          <p className="text-ui text-foreground">No sync service yet.</p>
          <p className="text-ui text-muted-foreground">
            Add one and kb walks you through it step by step, with links that open each page in
            Google Cloud.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((setup) => {
            const current = currentStep(setup);
            const done = SETUP_STEPS.filter((step) => stepDone(setup, step)).length;
            const state =
              setup.problem !== ""
                ? { dot: "bg-destructive", text: setup.problem }
                : current === "done"
                  ? { dot: "bg-success", text: "Connected and syncing" }
                  : setup.connected
                    ? { dot: "bg-warning", text: "Connected · pick calendars to sync" }
                    : {
                        dot: "border border-faint-foreground",
                        text: `Setting up · ${String(done)} of ${String(SETUP_STEPS.length)} steps done`,
                      };
            return (
              <li key={setup.id}>
                <button
                  type="button"
                  onClick={() => navigate(syncPath(setup.id))}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/60"
                >
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full", state.dot)}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ui font-medium text-foreground">
                      {setup.name || "Google Calendar"}
                      {setup.email === "" ? null : (
                        <span className="font-normal text-muted-foreground"> · {setup.email}</span>
                      )}
                    </span>
                    <span className="truncate text-meta text-muted-foreground">{state.text}</span>
                  </span>
                  <span className={BUTTON_CLASS}>
                    {current === "done" ? "Manage" : "Continue setup"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className={cn(PRIMARY_BUTTON_CLASS, "w-fit")}
        onClick={() => setPicking(true)}
        data-testid="add-sync-service"
      >
        <PlusIcon size={12} weight="bold" />
        Add sync service
      </button>
      {picking ? <ProviderPicker onClose={() => setPicking(false)} /> : null}
    </div>
  );
}

/** Answers already handed to the host this page: a redirect is used once, even if drawn twice. */
const handed = new Set<string>();

/**
 * Where Google sends the person back. The URL (its code and state) goes to
 * the host once, and leaves the address bar and history at once.
 */
function ConnectReturn() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const redirect = window.location.href;
    window.history.replaceState({}, "", CONNECT_PATH);
    if (handed.has(redirect)) return;
    handed.add(redirect);
    void setupCall("finish", { redirect }, Schema.Struct({ account: Schema.String })).then(
      (answer) => {
        if (answer.ok) {
          toast("Connected to Google");
          navigate(syncPath(answer.output.account));
        } else setError(answer.error);
      },
    );
  }, []);
  return (
    <div className="flex max-w-2xl flex-col gap-3" data-testid="routines-connect-return">
      {error === null ? (
        <p className="text-ui text-muted-foreground" role="status">
          Finishing the connection with Google…
        </p>
      ) : (
        <>
          <Verdict tone="error">{error}</Verdict>
          <button
            type="button"
            className={cn(BUTTON_CLASS, "w-fit")}
            onClick={() => navigate(syncPath())}
          >
            Back to sync services
          </button>
        </>
      )}
    </div>
  );
}

export function SyncPage({ params }: { readonly params: SyncParams }) {
  const nodes = useNodes();
  const account = params.account === undefined ? undefined : nodes.get(params.account);
  const title =
    params.returning === true
      ? "Connecting to Google"
      : params.account === undefined
        ? "Sync services"
        : account === undefined || account.text === ""
          ? "Google Calendar"
          : account.text;
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground"
      data-testid="routines-sync"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => navigate(params.account === undefined ? CALENDAR_PATH : syncPath())}
        >
          <ArrowLeftIcon size={12} />
          {params.account === undefined ? "Calendar" : "Sync services"}
        </button>
        <h1 className="min-w-0 truncate text-title text-foreground">{title}</h1>
      </div>
      <div className="flex flex-col gap-4 p-3 sm:p-6">
        {params.returning === true ? (
          <ConnectReturn />
        ) : params.account === undefined ? (
          <ServiceList />
        ) : (
          <SetupWizard account={params.account} />
        )}
      </div>
    </div>
  );
}
