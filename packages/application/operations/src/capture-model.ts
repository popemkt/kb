import { Effect } from "effect";
import { SYSTEM_IDS, extensionNodeId, seededField, type KbNode } from "@kb/model";

export const CAPTURE_IDS = {
  settings: extensionNodeId("core"),
  urlField: "sys.f.capture.url",
  urlSetting: "sys.f.capture.urlField",
  receipts: "sys.capture.receipts",
  devices: "sys.capture.devices",
  key: "sys.f.capture.key",
  digest: "sys.f.capture.digest",
  result: "sys.f.capture.result",
  expiry: "sys.f.capture.expiry",
  capturedAt: "sys.f.capture.capturedAt",
  source: "sys.f.capture.source",
} as const;

export function captureSeed(at: string): KbNode[] {
  const field = (id: string, label: string) =>
    seededField(id, label, "text", at, { one: true, show: "never" });
  return [
    seededField(CAPTURE_IDS.urlField, "Captured URL", "url", at, { one: true, show: "filled" }),
    seededField(CAPTURE_IDS.urlSetting, "Capture URL field", "ref", at, {
      one: true,
      props: {
        [SYSTEM_IDS.configuresField]: [{ t: "ref", v: CAPTURE_IDS.settings }],
        [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      },
    }),
    field(CAPTURE_IDS.key, "Capture identifier"),
    field(CAPTURE_IDS.digest, "Capture digest"),
    field(CAPTURE_IDS.expiry, "Pairing expiry"),
    field(CAPTURE_IDS.capturedAt, "Captured at"),
    field(CAPTURE_IDS.source, "Capture source app"),
    seededField(CAPTURE_IDS.result, "Captured node", "ref", at, { one: true }),
    ...(
      [
        [CAPTURE_IDS.receipts, "Capture receipts"],
        [CAPTURE_IDS.devices, "Capture devices"],
      ] as const
    ).map(([id, text]) => ({ id, text, props: {}, children: [], createdAt: at, updatedAt: at })),
  ];
}

export const captureDigest = Effect.fn("capture.digest")(function* (
  bytes: Uint8Array<ArrayBuffer>,
) {
  const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes));
  return new Uint8Array(digest).toHex();
});

export function digestText(text: string) {
  return captureDigest(new TextEncoder().encode(text));
}

export function recordsIn(nodes: readonly KbNode[], list: string): KbNode[] {
  const members = new Set(nodes.find(({ id }) => id === list)?.children);
  return nodes.filter(({ id }) => members.has(id));
}
