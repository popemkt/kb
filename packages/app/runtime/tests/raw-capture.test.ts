import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  CAPTURE_SUBMIT,
  CaptureReceiptSchema,
  type ActionReceipt,
  type CaptureSubmit,
} from "@kb/contracts";
import { DAYS_IDS } from "@kb/days";
import { SYSTEM_IDS, assetEmbedsOf, fieldTypeValue, present, strValueOf } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { openKb } from "../src/session.ts";
import { STORE_BACKENDS, createStore } from "../src/store-selection.ts";

const share = (content: Partial<CaptureSubmit>): CaptureSubmit => ({
  captureId: crypto.randomUUID(),
  capturedAt: "2026-11-17T01:02:03+07:00",
  ...content,
});

function output(receipt: ActionReceipt) {
  if (receipt.status !== "succeeded") throw new Error(JSON.stringify(receipt));
  return receipt.output;
}

for (const backend of STORE_BACKENDS) {
  describe(`raw capture registry contract (${backend})`, () => {
    test("files original mixed content once, in order, with durable concurrent receipts", async () => {
      const root = await mkdtemp(join(tmpdir(), "kb-raw-capture-"));
      try {
        await Effect.runPromise(
          createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)),
        );
        const ctx = await openKb(root);
        const other = await openKb(root);
        const manifest = output(await invoke(ctx, { id: "kb.manifest", input: {} }));
        expect(manifest).toMatchObject({ captureContract: 1 });

        const stored = output(
          await invoke(ctx, {
            id: "asset.upload",
            input: { filename: "second.png", bytes: "Ag==" },
          }),
        ) as { path: string };
        const input = share({
          source: { app: "Browser" },
          title: "Page",
          url: "https://example.com/a%20b#mark",
          text: "Selected\n日本語",
          files: [
            { name: "first.png", mime: "image/png", bytes: "AQ==" },
            { name: "second.png", mime: "image/png", path: stored.path },
          ],
        });
        const request = { id: CAPTURE_SUBMIT, input };
        const before = ctx.log.head;
        const [first, second] = await Promise.all([invoke(ctx, request), invoke(other, request)]);
        const receipt = CaptureReceiptSchema.parse(output(first));
        expect(output(second)).toEqual(receipt);

        const fresh = await openKb(root);
        expect(fresh.log.head).toBe(before + 1);
        expect(output(await invoke(fresh, request))).toEqual(receipt);
        expect(
          await invoke(fresh, { ...request, input: { ...input, text: "changed" } }),
        ).toMatchObject({
          status: "failed",
          code: "conflict",
        });
        const node = present(
          fresh.nodes.find(({ id }) => id === receipt.nodeId),
          "captured page",
        );
        expect(node.text).toBe("Page");
        expect(strValueOf(node, "sys.f.capture.url")).toBe(input.url ?? "");
        const children = node.children.map(
          (id) => fresh.nodes.find((row) => row.id === id)?.text ?? "",
        );
        expect(children[0]).toBe(input.text ?? "");
        const embeds = children.flatMap((text) => assetEmbedsOf(text));
        expect(embeds.map(({ alt }) => alt)).toEqual(["first.png", "second.png"]);
        expect(embeds[1]?.path).toBe(stored.path);
        for (const [index, { path }] of embeds.entries()) {
          expect(await readFile(join(root, ".kb", path))).toEqual(Buffer.from([index + 1]));
        }
        expect(await readdir(join(root, ".kb", "assets"))).toHaveLength(2);
        const day = fresh.nodes.find(({ children: ids }) => ids.includes(node.id));
        expect(strValueOf(day, DAYS_IDS.keyField)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("explicit placement and URL field ID win, and invalid input leaves the store intact", async () => {
      const root = await mkdtemp(join(tmpdir(), "kb-raw-destination-"));
      try {
        await Effect.runPromise(
          createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)),
        );
        const ctx = await openKb(root);
        const doCapture = (input: CaptureSubmit) => invoke(ctx, { id: CAPTURE_SUBMIT, input });
        const { id: parent } = output(
          await invoke(ctx, {
            id: "node.add",
            input: { text: "Inbox", parent: null },
          }),
        ) as { id: string };
        const { id: field } = output(
          await invoke(ctx, {
            id: "field.define",
            input: { name: "Source link" },
          }),
        ) as { id: string };
        output(
          await invoke(ctx, {
            id: "node.update",
            input: {
              id: field,
              setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("url") }],
            },
          }),
        );
        output(
          await invoke(ctx, {
            id: "node.update",
            input: {
              id: "sys.extension.core",
              setProps: [{ field: "sys.f.capture.urlField", value: { t: "ref", v: field } }],
            },
          }),
        );

        const url = "https://example.com";
        const captured = CaptureReceiptSchema.parse(
          output(
            await doCapture(
              share({
                text: url,
                target: { parent },
              }),
            ),
          ),
        );
        expect(ctx.nodes.find(({ id }) => id === parent)?.children).toEqual([captured.nodeId]);
        expect(
          strValueOf(
            ctx.nodes.find(({ id }) => id === captured.nodeId),
            field,
          ),
        ).toBe(url);

        output(await invoke(ctx, { id: "extension.switch", input: { name: "days", on: false } }));
        const top = CaptureReceiptSchema.parse(output(await doCapture(share({ text: "Top" }))));
        expect(ctx.nodes.some(({ children }) => children.includes(top.nodeId))).toBe(false);
        const before = ctx.log.head;
        expect(
          await doCapture(share({ text: "Missing", target: { parent: "missing" } })),
        ).toMatchObject({ status: "failed", code: "not_found" });
        expect(
          await doCapture(share({ text: "Wrong store", target: { store: "other" } })),
        ).toMatchObject({ status: "failed", code: "not_found" });
        expect(
          await doCapture(
            share({
              files: [
                { name: "good.png", mime: "image/png", bytes: "AQ==" },
                { name: "bad.html", mime: "text/html", bytes: "AQ==" },
              ],
            }),
          ),
        ).toMatchObject({ status: "failed", details: { index: 1, name: "bad.html" } });
        expect(ctx.log.head).toBe(before);
        expect(await Bun.file(join(root, ".kb/assets")).exists()).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
}
