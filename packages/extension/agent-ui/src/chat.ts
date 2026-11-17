/**
 * The sidebar's side of the agent channel (`@kb/agent` → `protocol.ts`): one
 * conversation at a time, drawn from the transcript `@kb/agent` reduces, and
 * the person's answer to an approval-required call.
 *
 * Approving or declining is a call the tab makes itself, through the
 * browser's one invoke path, with `approved` set to the person's answer;
 * the invoke core decides it, and its receipt is what the agent is told.
 * There is no second way for the sidebar to approve anything.
 *
 * Like the UI's other stores it is one per page. It reaches the channel and
 * the invoke path only through the ports its plugin attaches it to, which
 * the shell binds (`src/agent.ts`).
 */
import { create } from "zustand";
import {
  AGENT_WIRE,
  AgentEventSchema,
  newTranscript,
  withDecision,
  withDisconnect,
  withEvent,
  withSent,
  type AgentRequest,
  type ToolEntry,
  type Transcript,
} from "@kb/agent";
import { failed, onWire, type ActionInvocation, type ActionReceipt } from "@kb/contracts";

/** Where the chat reaches the agent and the graph. */
/**
 * Where the tab's connection stands: `offline` while it is closed, `unknown`
 * once open until the server says whose it is, then `person` or `nobody`.
 * A tab that is nobody's may not speak on the agent's channel, so the dock
 * knows that without trying.
 */
export type Standing = "offline" | "unknown" | "person" | "nobody";

export interface AgentPorts {
  /** Hear the agent channel; returns the unlisten. */
  readonly listen: (sink: {
    readonly data: (data: unknown) => void;
    readonly error: (err: { readonly code: string; readonly message: string }) => void;
  }) => () => void;
  /** Say one request on the agent channel. */
  readonly send: (request: AgentRequest) => void;
  /**
   * Call `listener` whenever the tab's connection changes: closed, open but
   * not told yet whose it is, or open and the person's or nobody's. Returns
   * the unsubscribe.
   */
  readonly connection: (listener: (standing: Standing) => void) => () => void;
  /** Make a call through the browser's one invoke path, and answer the server's receipt. */
  readonly invoke: (invocation: ActionInvocation) => Promise<ActionReceipt>;
  /** A fresh conversation id. */
  readonly newConversation: () => string;
  /** The agent finished a turn with its answer (not stopped, not failed): the page counts it. */
  readonly finished: () => void;
}

interface ChatState {
  readonly transcript: Transcript;
  /** Why the agent cannot be reached right now, or null when it can. */
  readonly unreachable: string | null;
}

const NO_AGENT = "This kb ui hosts no agent, so there is no one to chat with here.";
const OFFLINE = "Not connected to kb. Reconnecting…";
const NOT_YOURS =
  "This connection is not verified as you (it is not the kb page), so it cannot talk to your agent.";

export const useChat = create<ChatState>(() => ({
  transcript: newTranscript("detached"),
  unreachable: null,
}));

let ports: AgentPorts | null = null;

function update(change: (transcript: Transcript) => Transcript): void {
  useChat.setState((state) => ({ transcript: change(state.transcript) }));
}

function conversation(): string {
  return useChat.getState().transcript.conversation;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The person sent `text`. */
export function sendToAgent(text: string): void {
  if (ports === null) return;
  update((transcript) => withSent(transcript, text));
  ports.send({ type: "send", conversation: conversation(), text });
}

/** Stop the running turn. */
export function stopAgent(): void {
  ports?.send({ type: "cancel", conversation: conversation() });
}

/** The person approved or declined the call `call`: their tab makes it, with that answer. */
export function decideCall(call: string, approved: boolean): void {
  const bound = ports;
  const entry = useChat
    .getState()
    .transcript.entries.find((held): held is ToolEntry => held.kind === "tool" && held.id === call);
  if (bound === null || entry?.state !== "awaiting") return;
  update((transcript) => withDecision(transcript, call, approved ? "approved" : "declined"));
  const invocation = onWire(AGENT_WIRE, { id: entry.action, input: entry.input, approved });
  const at = conversation();
  void bound
    .invoke(invocation)
    .catch((error: unknown) => failed(entry.action, "internal", messageOf(error)))
    .then((receipt) => bound.send({ type: "receipt", conversation: at, call, receipt }));
}

/** Start a new conversation; the agent does not remember the last one. */
export function restartChat(): void {
  if (ports === null) return;
  const { transcript } = useChat.getState();
  if (transcript.running) ports.send({ type: "cancel", conversation: transcript.conversation });
  useChat.setState({ transcript: newTranscript(ports.newConversation()) });
}

function receive(data: unknown): void {
  const event = AgentEventSchema.safeParse(data);
  if (!event.success) return;
  update((transcript) => withEvent(transcript, event.data));
  if (event.data.type === "turn-end" && event.data.outcome === "done") ports?.finished();
}

/** Hear the channel and the socket through `next`; returns the detach. */
export function attachChat(next: AgentPorts): () => void {
  ports = next;
  useChat.setState({ transcript: newTranscript(next.newConversation()), unreachable: null });
  const unlisten = next.listen({
    data: receive,
    error: (err) => {
      if (err.code === "unknown_channel") useChat.setState({ unreachable: NO_AGENT });
      if (err.code === "forbidden") useChat.setState({ unreachable: NOT_YOURS });
      update((transcript) => ({ ...transcript, running: false }));
    },
  });
  const unwatch = next.connection((standing) => {
    if (standing === "offline") {
      update(withDisconnect);
      useChat.setState({ unreachable: OFFLINE });
      return;
    }
    if (standing === "nobody") {
      useChat.setState({ unreachable: NOT_YOURS });
      return;
    }
    // Open, and the person's or not yet told: what the connection said no longer holds.
    useChat.setState((state) => ({
      unreachable:
        state.unreachable === OFFLINE || (standing === "person" && state.unreachable === NOT_YOURS)
          ? null
          : state.unreachable,
    }));
  });
  return () => {
    unlisten();
    unwatch();
    if (ports === next) ports = null;
  };
}
