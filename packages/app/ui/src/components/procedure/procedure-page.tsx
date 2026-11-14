import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionReceiptSchema,
  ProcedureStatusSchema,
  ProcedureStepOutputSchema,
  type ProcedureStatus,
} from "@kb/contracts";
import { Button, cn, browserHost, failureText, hasText, type ViewProps } from "@kb/ui-sdk";
import type { ProcedureParams } from "@kb/views";
import { ProcedureResult } from "./result-summary";
import { useGraphStore } from "@/stores/graph.store";

/** A procedure's checks own progress; this page holds only the current reading and last output. */
function useProcedure(id: string) {
  const rev = useGraphStore((state) => state.rev);
  const [status, setStatus] = useState<ProcedureStatus>();
  const [readError, setReadError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [output, setOutput] = useState<unknown>();
  const [readKey, setReadKey] = useState<{ id: string; rev: number; refresh: number }>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const key = useMemo(() => ({ id, rev, refresh }), [id, rev, refresh]);
  const loading = readKey !== key;
  const running = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (busy) return undefined;
    let cancelled = false;
    const read = async () => {
      try {
        const receipt = await browserHost().invoke("procedure.status", { procedure: key.id });
        if (cancelled) return;
        if (receipt.status === "failed") throw new Error(failureText(receipt));
        setStatus(ProcedureStatusSchema.parse(receipt.output));
        setReadError(undefined);
      } catch (cause) {
        if (!cancelled) setReadError(String(cause));
      } finally {
        if (!cancelled) setReadKey(key);
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [key, busy]);
  const run = useCallback(
    async (step: string, action: string) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setActionError(undefined);
      setOutput(undefined);
      try {
        const outer = await browserHost().invoke("procedure.step", { procedure: id, step, action });
        if (!alive.current) return;
        if (outer.status === "failed") throw new Error(failureText(outer));
        const result = ProcedureStepOutputSchema.parse(outer.output);
        const receipt = ActionReceiptSchema.parse(result.receipt);
        setStatus(result.status);
        if (receipt.status === "failed") throw new Error(failureText(receipt));
        setOutput(receipt.output);
        if (result.status.current === step)
          setActionError(
            "The step ran, but its check has not advanced. Review the result before trying again.",
          );
      } catch (cause) {
        if (alive.current) setActionError(String(cause));
      } finally {
        running.current = false;
        if (alive.current) {
          setBusy(false);
          setRefresh((value) => value + 1);
        }
      }
    },
    [id],
  );
  return {
    status,
    error: actionError ?? readError,
    unavailable: readError !== undefined,
    output,
    loading,
    busy,
    run,
    refresh: () => setRefresh((value) => value + 1),
  };
}

function StepState({ done, current }: { readonly done: boolean; readonly current: boolean }) {
  if (done)
    return (
      <span className="mr-2 inline-flex rounded-full bg-success/10 px-2 py-0.5 text-label text-foreground">
        ✓ Done
      </span>
    );
  if (current)
    return (
      <span className="mr-2 inline-flex rounded-full bg-primary px-2 py-0.5 text-label text-primary-foreground">
        Current
      </span>
    );
  return (
    <span className="mr-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-label text-muted-foreground">
      Pending
    </span>
  );
}

/** Every procedure uses this one walker; decisions always require the person's chosen action. */
function ProcedureBody({ id }: ProcedureParams) {
  const state = useProcedure(id);
  const status = state.status?.id === id ? state.status : undefined;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="kb-display text-title font-semibold">{status?.title ?? "Procedure"}</h1>
        {hasText(status?.description) && (
          <p className="text-muted-foreground">{status.description}</p>
        )}
        <Button variant="ghost" onClick={state.refresh} disabled={state.busy || state.loading}>
          Refresh status
        </Button>
      </header>
      {hasText(state.error) && <p role="alert">{state.error}</p>}
      {state.loading && <p role="status">Reading progress…</p>}
      {status && (
        <ol className="space-y-6" aria-label="Procedure steps">
          {status.steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "space-y-3 rounded-lg border p-4",
                step.done
                  ? "border-border bg-muted/30"
                  : status.current === step.id
                    ? "border-primary bg-primary/5"
                    : "border-border text-muted-foreground",
              )}
              aria-current={status.current === step.id ? "step" : undefined}
            >
              <h2 className="font-medium">
                <StepState done={step.done} current={status.current === step.id} />
                {step.title}
              </h2>
              {hasText(step.description) && <p>{step.description}</p>}
              {step.check.status === "failed" && <p role="alert">{step.check.message}</p>}
              {[...new Set(step.notes)].map((note) => (
                <p key={note}>{note}</p>
              ))}
              {!step.done && (
                <div className="flex flex-wrap gap-3">
                  {step.actions.map((action) => (
                    <div key={action.id} className="space-y-1">
                      <Button
                        variant={action.tone === "destructive" ? "destructive" : "primary"}
                        disabled={
                          status.current !== step.id ||
                          state.busy ||
                          state.loading ||
                          state.unavailable ||
                          step.check.status === "failed"
                        }
                        onClick={() => void state.run(step.id, action.id)}
                      >
                        {action.title}
                      </Button>
                      {action.id === step.recommended && (
                        <p className="text-muted-foreground">Recommended</p>
                      )}
                      {hasText(action.description) && <p>{action.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {status?.current === null && <p role="status">Every step is done.</p>}
      {state.output !== undefined && <ProcedureResult output={state.output} />}
    </main>
  );
}

/** A route identity owns its transient reading and last result. */
export function ProcedurePage({ params }: ViewProps<ProcedureParams>) {
  return <ProcedureBody key={params.id} id={params.id} />;
}
