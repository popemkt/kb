/**
 * One sync service's setup: numbered steps with where the person is, the
 * open step's panel, and, once every step is done, the connection with
 * Reconnect and Remove. Where the person is comes from the account node
 * (`@kb/routines` → setup.ts) each render, so leaving and coming back
 * resumes there; which step is open is only this page's.
 */
import { useState, type ComponentType } from "react";
import { CheckIcon, LockSimpleIcon } from "@phosphor-icons/react";
import {
  currentStep,
  deleteNode,
  readAccountSetup,
  setCalendarSync,
  SETUP_STEPS,
  stepDone,
  stepOpen,
  updateNode,
  ROUTINE_FIELDS as F,
  type AccountSetup,
  type SetupStep,
} from "@kb/routines";
import { cn, navigate, useNarrowViewport, useNodes } from "@kb/ui-sdk";
import { BUTTON_CLASS, Dialog, PRIMARY_BUTTON_CLASS } from "./dialog";
import { syncPath } from "./routes";
import { Schema } from "effect";
import { consolePage, setupCall, startConnect, useSetupInfo, type SetupInfo } from "./setup-calls";
import { Pick, Verdict } from "./setup-parts";
import {
  ApisStep,
  AudienceStep,
  BrandingStep,
  CalendarsStep,
  ClientStep,
  ConnectStep,
  ProjectStep,
  type StepProps,
} from "./setup-steps";
import { runCalls } from "./writes";

const STEPS: Readonly<
  Record<SetupStep, { readonly label: string; readonly Body: ComponentType<StepProps> }>
> = {
  project: { label: "Project", Body: ProjectStep },
  apis: { label: "Calendar API", Body: ApisStep },
  branding: { label: "Consent screen", Body: BrandingStep },
  audience: { label: "Publish", Body: AudienceStep },
  client: { label: "OAuth client", Body: ClientStep },
  connect: { label: "Connect", Body: ConnectStep },
  calendars: { label: "Calendars", Body: CalendarsStep },
};

const MARKER_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-label";

function StepMarker({
  setup,
  step,
  index,
}: {
  readonly setup: AccountSetup;
  readonly step: SetupStep;
  readonly index: number;
}) {
  if (stepDone(setup, step))
    return (
      <span className={`${MARKER_CLASS} border-success bg-success/20 text-foreground`} aria-hidden>
        <CheckIcon size={12} weight="bold" />
      </span>
    );
  return (
    <span
      className={cn(
        MARKER_CLASS,
        currentStep(setup) === step
          ? "border-primary text-primary"
          : "border-border text-muted-foreground",
      )}
      aria-hidden
    >
      {index + 1}
    </span>
  );
}

/** The steps, numbered: done, where the person is, and those waiting. */
function Stepper({
  setup,
  open,
  onOpen,
  narrow,
}: {
  readonly setup: AccountSetup;
  readonly open: SetupStep | null;
  readonly onOpen: (step: SetupStep) => void;
  readonly narrow: boolean;
}) {
  return (
    <ol
      className={cn(
        "flex gap-1",
        narrow ? "-mx-1 overflow-x-auto px-1 pb-1" : "w-52 shrink-0 flex-col",
      )}
      aria-label="Setup steps"
    >
      {SETUP_STEPS.map((step, index) => {
        const reachable = stepOpen(setup, step);
        return (
          <li key={step} className="shrink-0">
            <button
              type="button"
              disabled={!reachable}
              aria-current={step === open ? "step" : undefined}
              data-setup-step={step}
              data-setup-done={stepDone(setup, step) ? "" : undefined}
              onClick={() => onOpen(step)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-foreground",
                step === open ? "bg-accent shadow-edge" : "hover:bg-accent/60",
                !reachable && "cursor-not-allowed opacity-60 hover:bg-transparent",
              )}
            >
              <StepMarker setup={setup} step={step} index={index} />
              <span className={cn("truncate", narrow && step !== open && "sr-only")}>
                {STEPS[step].label}
              </span>
              {reachable ? null : <LockSimpleIcon size={12} className="ml-auto" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Steps done of all, as a bar and in words. */
function Progress({ setup }: { readonly setup: AccountSetup }) {
  const done = SETUP_STEPS.filter((step) => stepDone(setup, step)).length;
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={SETUP_STEPS.length}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${(done / SETUP_STEPS.length) * 100}%` }}
        />
      </div>
      <span className="text-meta text-muted-foreground">
        {done === SETUP_STEPS.length
          ? "Set up"
          : `${String(done)} of ${String(SETUP_STEPS.length)} steps done`}
      </span>
    </div>
  );
}

/** Asking before removing: what goes and what stays. */
function RemoveDialog({
  busy,
  onCancel,
  onRemove,
}: {
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <Dialog title="Remove this sync service?" onClose={onCancel}>
      <p className="text-ui text-foreground">
        kb revokes its access at Google and erases the client and token it kept on this host. Its
        calendars stay in kb, paused, and their Google calendars stay in your account.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_CLASS} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={cn(BUTTON_CLASS, "text-destructive hover:bg-destructive/10")}
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </Dialog>
  );
}

/** Once set up: how the connection stands, with Reconnect and Remove. */
function Connected({
  setup,
  info,
  onReview,
}: {
  readonly setup: AccountSetup;
  readonly info: SetupInfo | null;
  readonly onReview: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reconnect = async () => {
    setBusy(true);
    setError(await startConnect(setup.id));
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    const removed = await setupCall(
      "remove",
      { account: setup.id },
      Schema.Struct({ revoked: Schema.Boolean }),
    );
    if (!removed.ok) {
      setError(removed.error);
      setBusy(false);
      return;
    }
    // Its calendars stay, held: they stop sending until another account takes them.
    const calls = setup.calendars.flatMap((calendar) => [
      setCalendarSync(calendar.id, "paused"),
      updateNode(calendar.id, { [F.account]: [] }),
    ]);
    if (await runCalls([...calls, deleteNode(setup.id)], "Could not remove it"))
      navigate(syncPath());
    setBusy(false);
  };
  return (
    <section className="flex flex-col gap-4" data-setup-panel="connected">
      <header className="flex flex-col gap-1">
        <h2 className="text-heading text-foreground">
          {setup.connected ? "Connected to Google" : "Not connected"}
        </h2>
        <p className="text-ui text-muted-foreground">
          {setup.email === "" ? "Google account" : setup.email} · project{" "}
          <a
            className="text-primary hover:underline"
            href={consolePage("auth/clients", setup.project)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {setup.project}
          </a>
        </p>
      </header>
      {setup.problem === "" ? null : <Verdict tone="error">{setup.problem}</Verdict>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted-foreground">Secrets</dt>
        <dd className="text-foreground">Kept {info?.store ?? "on kb's host"}</dd>
        <dt className="text-muted-foreground">Calendars</dt>
        <dd className="flex flex-col gap-0.5 text-foreground">
          {setup.calendars.length === 0
            ? "None yet"
            : setup.calendars.map((calendar) => (
                <span key={calendar.id}>
                  {calendar.name}{" "}
                  <span className="text-muted-foreground">
                    ·{" "}
                    {calendar.provisioned && calendar.mode === "on"
                      ? "syncing"
                      : calendar.provisioned
                        ? calendar.mode
                        : "no Google calendar yet"}
                  </span>
                </span>
              ))}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASS}
          disabled={busy}
          onClick={() => void reconnect()}
        >
          Reconnect
        </button>
        <button type="button" className={BUTTON_CLASS} onClick={onReview}>
          Review the steps
        </button>
        <button
          type="button"
          className={cn(BUTTON_CLASS, "text-destructive")}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Remove
        </button>
      </div>
      {error === null ? null : <Verdict tone="error">{error}</Verdict>}
      {confirming ? (
        <RemoveDialog
          busy={busy}
          onCancel={() => setConfirming(false)}
          onRemove={() => {
            setConfirming(false);
            void remove();
          }}
        />
      ) : null}
    </section>
  );
}

/** The open step's body, then the way on: Next once it is done, or Done after the last. */
function StepPanel({
  setup,
  info,
  step,
  done,
  onOpen,
}: {
  readonly setup: AccountSetup;
  readonly info: SetupInfo | null;
  readonly step: SetupStep;
  readonly done: boolean;
  readonly onOpen: (step: SetupStep | "overview") => void;
}) {
  const { Body } = STEPS[step];
  const index = SETUP_STEPS.indexOf(step);
  const next = SETUP_STEPS[index + 1];
  const onward =
    next === undefined
      ? done
        ? { label: "Done", go: () => onOpen("overview") }
        : null
      : stepDone(setup, step)
        ? { label: `Next: ${STEPS[next].label}`, go: () => onOpen(next) }
        : null;
  return (
    <>
      <Body key={step} setup={setup} info={info} index={index + 1} />
      {onward === null ? null : (
        <div className="flex justify-end border-t border-border pt-3">
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={onward.go}>
            {onward.label}
          </button>
        </div>
      )}
    </>
  );
}

export function SetupWizard({ account }: { readonly account: string }) {
  const nodes = useNodes();
  const narrow = useNarrowViewport();
  const info = useSetupInfo();
  const node = nodes.get(account);
  const setup = node === undefined ? null : readAccountSetup(node, nodes);
  // The step the page opened at stays open, so a check that passes stays on screen until Next.
  const [chosen, setChosen] = useState<SetupStep | "overview" | null>(() => {
    if (setup === null) return null;
    const resume = currentStep(setup);
    return resume === "done" ? "overview" : resume;
  });
  if (setup === null)
    return (
      <div className="flex flex-col gap-3 p-4">
        <Verdict tone="error">This sync service no longer exists.</Verdict>
        <button
          type="button"
          className={cn(BUTTON_CLASS, "w-fit")}
          onClick={() => navigate(syncPath())}
        >
          Back to sync services
        </button>
      </div>
    );
  const current = currentStep(setup);
  const open: SetupStep | "overview" =
    chosen !== null && (chosen === "overview" || stepOpen(setup, chosen))
      ? chosen
      : current === "done"
        ? "overview"
        : current;
  const step = open === "overview" ? null : open;
  return (
    <div
      className={cn("flex min-h-0 gap-6", narrow ? "flex-col" : "flex-row items-start")}
      data-testid="routines-setup"
      data-setup-current={current}
    >
      <div className={cn("flex flex-col gap-3", !narrow && "sticky top-0")}>
        <Progress setup={setup} />
        <Stepper setup={setup} open={step} onOpen={setChosen} narrow={narrow} />
        {current === "done" && step !== null ? (
          <button
            type="button"
            className={cn(BUTTON_CLASS, "w-fit")}
            onClick={() => setChosen("overview")}
          >
            Connection
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        {step === null ? (
          <Connected setup={setup} info={info} onReview={() => setChosen("project")} />
        ) : (
          <StepPanel
            setup={setup}
            info={info}
            step={step}
            done={current === "done"}
            onOpen={setChosen}
          />
        )}
        {open === "project" && setup.project === "" ? null : (
          <p className="text-meta text-muted-foreground">
            Leave any time: kb keeps your place for this service, in this kb.
            {setup.project === "" ? null : (
              <>
                {" "}
                Project <Pick>{setup.project}</Pick>.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
