/**
 * A Chat Completions endpoint played by a model double, over the adapter's
 * own wire: it reads the request body the adapter sent, shows the model what
 * a real server would hand it, and streams its moves back as server-sent
 * events, text in two pieces and each call's arguments split across chunks,
 * as servers do.
 */
import { isAgentImageType, type AgentImage, type ModelDouble } from "@kb/agent";
import type { ChatFetch, ChatRequestInit } from "../src/index.ts";

/** A part of a user message's content: its text, or a picture as a `data:` URL. */
type WirePart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

interface WireMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | readonly WirePart[] | null;
  readonly tool_calls?: readonly unknown[];
  readonly tool_call_id?: string;
}

interface WireRequest {
  readonly model: string;
  readonly stream: boolean;
  readonly messages: readonly WireMessage[];
  readonly tools?: readonly { readonly function: { readonly name: string } }[];
}

/** A message's text: its content, or the text of its parts. */
function textOf(content: WireMessage["content"]): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** The pictures a message's parts carry, read back from their `data:` URLs. */
function imagesOf(content: WireMessage["content"] | undefined): readonly AgentImage[] {
  if (content === undefined || content === null || typeof content === "string") return [];
  return content.flatMap((part) => {
    if (part.type !== "image_url") return [];
    const url = /^data:([^;]+);base64,(.*)$/.exec(part.image_url.url);
    const mediaType = url?.[1] ?? "";
    return isAgentImageType(mediaType) ? [{ mediaType, data: url?.[2] ?? "" }] : [];
  });
}

/** What the model is shown: the conversation as the request carries it. */
function sightOf(request: WireRequest) {
  const { messages } = request;
  const last = messages.findLastIndex((message) => message.role === "user");
  const since = messages.slice(last + 1);
  return {
    tools: (request.tools ?? []).map((tool) => tool.function.name),
    users: messages.flatMap((message) =>
      message.role === "user" ? [textOf(message.content)] : [],
    ),
    images: imagesOf(messages[last]?.content),
    results: since.flatMap((message) => (message.role === "tool" ? [textOf(message.content)] : [])),
    step: since.filter((message) => message.role === "assistant").length + 1,
  };
}

const sse = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;
const delta = (value: Record<string, unknown>) => sse({ choices: [{ index: 0, delta: value }] });

function halves(text: string): readonly [string, string] {
  const middle = Math.ceil(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)];
}

/** Every request the fake was sent, with what it was sent to. */
export interface FakeChat {
  readonly fetch: ChatFetch;
  readonly requests: {
    readonly url: string;
    readonly init: ChatRequestInit;
    readonly body: WireRequest;
  }[];
}

export function fakeChat(model: ModelDouble): FakeChat {
  const requests: FakeChat["requests"] = [];
  let calls = 0;
  const fetch: ChatFetch = (url, init) => {
    const body = JSON.parse(init.body) as WireRequest;
    requests.push({ url, init, body });
    const moves = model(sightOf(body));
    const failure = moves.find((move) => "fail" in move);
    if (failure !== undefined && "fail" in failure) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: failure.fail } }), { status: 500 }),
      );
    }
    const events: string[] = [delta({ role: "assistant" })];
    let index = 0;
    const stalled = moves.find((move) => "stall" in move);
    for (const move of moves) {
      if ("say" in move) {
        for (const piece of halves(move.say)) events.push(delta({ content: piece }));
      } else if ("call" in move) {
        const at = index++;
        const [head, tail] = halves(JSON.stringify(move.input));
        events.push(
          delta({
            tool_calls: [
              {
                index: at,
                id: `call_${++calls}`,
                type: "function",
                function: { name: move.call, arguments: head },
              },
            ],
          }),
          delta({ tool_calls: [{ index: at, function: { arguments: tail } }] }),
        );
      }
    }
    if (stalled !== undefined && "stall" in stalled) {
      // Thinking: the reply stays open until the request is aborted or its reader cancels.
      let told = false;
      const cancelled = () => {
        if (told) return;
        told = true;
        stalled.stall.cancelled();
      };
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(events.join("")));
              init.signal.addEventListener("abort", cancelled, { once: true });
              stalled.stall.thinking();
            },
            cancel: cancelled,
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      );
    }
    events.push(
      sse({ choices: [{ index: 0, delta: {}, finish_reason: index > 0 ? "tool_calls" : "stop" }] }),
      "data: [DONE]\n\n",
    );
    const bytes = new TextEncoder().encode(events.join(""));
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            // Split mid-line, as a network does, so the reader must join lines across reads.
            const cut = Math.floor(bytes.length / 3);
            controller.enqueue(bytes.slice(0, cut));
            controller.enqueue(bytes.slice(cut));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
  };
  return { fetch, requests };
}
