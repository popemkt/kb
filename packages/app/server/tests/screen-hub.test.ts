/**
 * `ScreenHub` on its own, where the order of connections, closes and sends
 * can be set exactly: who owns a tab id, what a late close may forget, and a
 * command whose socket will not take it. The same hub behind a real `/ws` is
 * `screens.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ScreenState, ServerMessage } from "@kb/contracts";
import { FAKE_TAB_SCREEN } from "@kb/test-kit";
import { ScreenHub, type KeepPicture } from "../src/screens.ts";
import { ClientGone, type ClientSend } from "../src/session.ts";

const run = Effect.runPromise;

/** A connection's send that keeps what it was handed. */
function socket(): { send: ClientSend; frames: ServerMessage[] } {
  const frames: ServerMessage[] = [];
  return {
    frames,
    send: (text) =>
      Effect.sync(() => {
        frames.push(JSON.parse(text) as ServerMessage);
      }),
  };
}

const gone: ClientSend = () => Effect.fail(new ClientGone());

function routes(hub: ScreenHub) {
  return run(hub.port.screen({ session: undefined })).then(({ tabs }) =>
    tabs.map(({ tab, route }) => [tab, route]),
  );
}

const at = (route: string): ScreenState => ({ ...FAKE_TAB_SCREEN, route });

/** Keeps nothing: says where a picture would be, so a receipt can be read. */
const keptAt: KeepPicture = (name, picture) =>
  Effect.succeed({
    mime: picture.mime,
    path: `/kept/${name}.png`,
    width: picture.width,
    height: picture.height,
  });

describe("ScreenHub", () => {
  test("a tab id belongs to the first live connection that publishes it", async () => {
    const hub = new ScreenHub(keptAt);
    const first = socket();
    const second = socket();
    await run(hub.publish("c1", "tab.a", first.send, at("/"), null));
    await run(hub.publish("c2", "tab.a", second.send, at("/canvas"), null));
    expect(second.frames).toEqual([{ op: "screen-refused", tab: "tab.a", code: "tab_in_use" }]);
    expect(await routes(hub)).toEqual([["tab.a", "/"]]);
  });

  test("a late close from an old connection does not forget the tab a new one owns", async () => {
    const hub = new ScreenHub(keptAt);
    await run(hub.publish("c1", "tab.a", socket().send, at("/"), null));
    await run(hub.drop("c1"));
    await run(hub.publish("c2", "tab.a", socket().send, at("/canvas"), null));
    await run(hub.drop("c1"));
    expect(await routes(hub)).toEqual([["tab.a", "/canvas"]]);
  });

  test("a connection is one tab: publishing under a new id gives up the old one", async () => {
    const hub = new ScreenHub(keptAt);
    const send = socket().send;
    await run(hub.publish("c1", "tab.a", send, at("/"), null));
    await run(hub.publish("c1", "tab.b", send, at("/graph"), null));
    expect(await routes(hub)).toEqual([["tab.b", "/graph"]]);
  });

  test("the person's tabs come before nobody's, and a command with no tab goes to theirs", async () => {
    const hub = new ScreenHub(keptAt);
    const person = { name: "owner" };
    const theirs = socket();
    const nobodys = socket();
    await run(hub.publish("c1", "tab.theirs", theirs.send, { ...at("/"), active: false }, person));
    await run(
      hub.publish("c2", "tab.nobodys", nobodys.send, { ...at("/graph"), active: true }, null),
    );
    const { tabs } = await run(hub.port.screen({ session: undefined }));
    expect(tabs.map(({ tab, person: by }) => [tab, by])).toEqual([
      ["tab.theirs", person],
      ["tab.nobodys", null],
    ]);
    void run(
      hub.port.select(
        {
          pane: undefined,
          timeoutMs: 50,
          selection: undefined,
          focus: "n1",
        },
        undefined,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(theirs.frames.map(({ op }) => op)).toEqual(["screen-command"]);
    expect(nobodys.frames).toEqual([]);
  });

  test("a command whose socket will not take it is no-tab at once, not a timeout", async () => {
    const hub = new ScreenHub(keptAt);
    await run(hub.publish("c1", "tab.a", gone, at("/"), null));
    const started = Date.now();
    const receipt = await run(
      hub.port.navigate(
        {
          pane: undefined,
          timeoutMs: 5000,
          node: undefined,
          route: "/",
          camera: undefined,
        },
        undefined,
      ),
    );
    expect(receipt).toEqual({ outcome: "no-tab", tab: "tab.a" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("a capture the tab answers with a picture is answered with the file it is kept in", async () => {
    const hub = new ScreenHub(keptAt);
    const { send, frames } = socket();
    await run(hub.publish("c1", "tab.a", send, at("/canvas"), null));
    const receipt = Effect.runPromise(
      hub.port.capture(
        {
          pane: undefined,
          timeoutMs: 5000,
          view: { preset: "top" },
        },
        undefined,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [frame] = frames;
    expect(frame).toMatchObject({
      op: "screen-command",
      command: { kind: "capture", view: { preset: "top" } },
    });
    const id = frame?.op === "screen-command" ? frame.id : "";
    const picture = { mime: "image/png" as const, data: "iVBORw0KGgo=", width: 4, height: 3 };
    await run(hub.ack("c1", id, { outcome: "applied", picture }));
    const answered = await receipt;
    expect(answered).toMatchObject({
      outcome: "applied",
      tab: "tab.a",
      capture: { mime: "image/png", width: 4, height: 3 },
    });
    expect(answered.outcome === "applied" ? answered.capture?.path : "").toStartWith("/kept/");
  });
});
