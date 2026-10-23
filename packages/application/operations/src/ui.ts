/**
 * `ui.screen`, `ui.navigate`, `ui.select`, `ui.capture`: what the open kb UI
 * tabs show, the two commands that move them, and the one that draws a
 * canvas's picture (`DESIGN.md` → Screen state).
 *
 * They touch no store. Each reads or drives the {@link Screens} port the
 * invoke tip provides: the `kb ui` server holds the tabs, and every other
 * process reaches that server's. They are ordinary registry actions all the
 * same, so the CLI, MCP, HTTP and WebMCP list them and return the same
 * receipt for them, and they run through the one invoke path.
 *
 * The two commands that move a tab are writes, because they change what a
 * person sees, and they need no approval; `DESIGN.md` → Screen state says
 * why. A capture moves nothing a person sees: it is a read.
 *
 * A command goes to the tab it names, else to the tab session the call is
 * made in, else to the person's most recently active tab.
 */
import { Effect } from "effect";
import {
  CurrentCall,
  ScreenListSchema,
  ScreenReceiptSchema,
  Screens,
  UiCaptureInputSchema,
  UiNavigateInputSchema,
  UiScreenInputSchema,
  UiSelectInputSchema,
  type ActionDefinition,
  type ScreenList,
  type ScreenReceipt,
  type UiCaptureInput,
  type UiNavigateInput,
  type UiScreenInput,
  type UiSelectInput,
} from "@kb/contracts";
import type { DomainError } from "@kb/model";

export const uiScreenDef = {
  id: "ui.screen",
  title: "Read the screen",
  description:
    "What each open kb UI tab shows, most recently active first: route, panes, the open view, " +
    "focused node, selection, and a canvas's viewport and visible items. Pass `tab` for one tab.",
  mode: { kind: "read" } as const,
  inputSchema: UiScreenInputSchema,
  outputSchema: ScreenListSchema,
} satisfies ActionDefinition;

export const uiNavigateDef = {
  id: "ui.navigate",
  title: "Navigate a tab",
  description:
    "Open a node (`node`) or a route (`route`) in a kb UI tab (the call's tab session, else the " +
    "most recently active), and/or point the camera of the canvas it shows (`camera`): items to frame (one " +
    "frame alone is looked at face-on), a view preset to look from (top, front, right, back, " +
    "left, oblique), both, or a pose as ui.screen reports one — to show the person something. " +
    "Answers whether a live tab applied it within `timeoutMs`.",
  mode: { kind: "write" } as const,
  inputSchema: UiNavigateInputSchema,
  outputSchema: ScreenReceiptSchema,
} satisfies ActionDefinition;

export const uiSelectDef = {
  id: "ui.select",
  title: "Select in a tab",
  description:
    "Set the selection (`selection`, ids in the open view's terms) or move the focus (`focus`, a " +
    "node id) in a kb UI tab (the call's tab session, else the most recently active). Answers " +
    "whether a live tab " +
    "applied it within `timeoutMs`.",
  mode: { kind: "write" } as const,
  inputSchema: UiSelectInputSchema,
  outputSchema: ScreenReceiptSchema,
} satisfies ActionDefinition;

export const uiCaptureDef = {
  id: "ui.capture",
  title: "Capture a canvas",
  description:
    "Have the canvas open in a kb UI tab (the call's tab session, else the most recently active) " +
    "draw what its " +
    "camera would see from `view` — items to frame, a view preset (top, front, right, back, " +
    "left, oblique), both, or a pose — without moving the person's camera, and keep it as a PNG " +
    "file; the receipt's `capture.path` is where it is. A canvas showing 2D draws it through its " +
    "3D scene (2D is that scene's top view). Answers `no-tab` when no tab is open.",
  mode: { kind: "read" } as const,
  inputSchema: UiCaptureInputSchema,
  outputSchema: ScreenReceiptSchema,
} satisfies ActionDefinition;

/** `input` aimed at the tab it names, else at the tab session its call is made in. */
const inSession = Effect.fn("ui.session")(function* <
  I extends { readonly tab?: string | undefined },
>(input: I) {
  const session = (yield* CurrentCall)?.invocation.session;
  return input.tab === undefined && session !== undefined ? { ...input, tab: session } : input;
});

export const uiCaptureEffect = Effect.fn("ui.capture")(function* (
  input: UiCaptureInput,
): Effect.fn.Return<ScreenReceipt, DomainError, Screens> {
  return yield* (yield* Screens).capture(yield* inSession(input));
});

export const uiScreenEffect = Effect.fn("ui.screen")(function* (
  input: UiScreenInput,
): Effect.fn.Return<ScreenList, DomainError, Screens> {
  return yield* (yield* Screens).screen(input);
});

export const uiNavigateEffect = Effect.fn("ui.navigate")(function* (
  input: UiNavigateInput,
): Effect.fn.Return<ScreenReceipt, DomainError, Screens> {
  return yield* (yield* Screens).navigate(yield* inSession(input));
});

export const uiSelectEffect = Effect.fn("ui.select")(function* (
  input: UiSelectInput,
): Effect.fn.Return<ScreenReceipt, DomainError, Screens> {
  return yield* (yield* Screens).select(yield* inSession(input));
});
