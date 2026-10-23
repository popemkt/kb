import { Effect, Layer, Option } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  ActionResponseSchema,
  envelopeOf,
  type ActionRequest,
  SCREEN_COMMAND_TIMEOUT_MS,
  ScreenListSchema,
  ScreenReceiptSchema,
  Screens,
  noTabReceipt,
  type ScreenList,
  type ScreenReceipt,
  type UiCaptureInput,
  type UiNavigateInput,
  type UiSelectInput,
  uiListenerName,
} from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { uiCaptureDef, uiNavigateDef, uiScreenDef, uiSelectDef } from "@kb/operations";
import { nothingListens, requestUi, servingUi } from "@kb/workspace-fs";

/** How much longer than the command's own wait the server gets to answer. */
const ANSWER_MARGIN_MS = 2000;

/** What a decoded answer is, or why it is not one. */
type Decoded<A> = { success: true; data: A } | { success: false; error: { message: string } };

/**
 * The {@link Screens} port for every process that is not the `kb ui` server:
 * the CLI, `kb mcp`, a test. The tabs live in the server that serves this
 * root, so each call asks that server, found through `.kb/ui.json`, the same
 * `ui.*` action its caller invoked, made in the tab session the command is
 * for; the server's own adapter answers it. A
 * root no server serves has no tabs: the list is empty and a command gets
 * `no-tab`. So does a presence file whose server no longer answers, or
 * whose listener a server of another root now holds (`servingUi`).
 */
export function remoteScreensLayer(root: string): Layer.Layer<Screens, never, FileSystem> {
  return Layer.effect(
    Screens,
    Effect.gen(function* () {
      const context = yield* Effect.context<FileSystem>();

      const ask = Effect.fn("kb.screens.ask")(function* <A>(
        call: ActionRequest,
        waitMs: number,
        decode: (output: unknown) => Decoded<A>,
        none: A,
      ): Effect.fn.Return<A, DomainError, FileSystem> {
        const { id } = call;
        const at = yield* servingUi(root);
        if (at === null) return none;
        const where = uiListenerName(at);
        const post = Effect.tryPromise({
          try: (signal) =>
            requestUi(at, "/api/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(envelopeOf(call)),
              signal,
            }),
          // Nothing listens there, or the request failed some other way.
          catch: (cause) => (nothingListens(cause) ? ("gone" as const) : ("failed" as const)),
        }).pipe(
          Effect.flatMap((res) =>
            Effect.tryPromise(() => res.json()).pipe(
              Effect.orElseSucceed((): unknown => null),
              Effect.map((body) => ({ status: res.status, body })),
            ),
          ),
        );
        const sent = yield* post.pipe(
          Effect.timeoutOption(waitMs + ANSWER_MARGIN_MS),
          Effect.catch((failure) =>
            failure === "gone"
              ? Effect.succeed(null)
              : Effect.fail(domainError("internal", `kb ui at ${where} could not be asked ${id}`)),
          ),
        );
        // Nothing listens where the presence file points: its server has gone.
        if (sent === null) return none;
        if (Option.isNone(sent)) {
          return yield* domainError("internal", `kb ui at ${where} did not answer ${id} in time`);
        }
        const { status, body } = sent.value;
        const response = ActionResponseSchema.safeParse(body);
        if (!response.success) {
          return yield* domainError("internal", `kb ui at ${where} answered ${id} with ${status}`);
        }
        if (response.data.status === "failed") {
          const { code, message } = response.data;
          return yield* domainError(
            "internal",
            `kb ui at ${where} failed ${id} (${code}): ${message}`,
          );
        }
        const output = decode(response.data.output);
        if (!output.success) {
          return yield* domainError(
            "internal",
            `kb ui at ${where} answered ${id} with output its schema rejects: ${output.error.message}`,
          );
        }
        return output.data;
      });

      const command = (
        id: string,
        input: UiNavigateInput | UiSelectInput | UiCaptureInput,
        tab: string | undefined,
      ) =>
        ask<ScreenReceipt>(
          { id, input, ...(tab === undefined ? {} : { session: tab }) },
          input.timeoutMs ?? SCREEN_COMMAND_TIMEOUT_MS,
          (output) => ScreenReceiptSchema.safeParse(output),
          noTabReceipt(tab),
        ).pipe(Effect.provide(context));

      return Screens.of({
        screen: (input) =>
          ask<ScreenList>(
            { id: uiScreenDef.id, input },
            0,
            (output) => ScreenListSchema.safeParse(output),
            { tabs: [] },
          ).pipe(Effect.provide(context)),
        navigate: (input, tab) => command(uiNavigateDef.id, input, tab),
        select: (input, tab) => command(uiSelectDef.id, input, tab),
        capture: (input, tab) => command(uiCaptureDef.id, input, tab),
      });
    }),
  );
}
