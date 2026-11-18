import { Context } from "effect";
import { z } from "zod";

export const CAPTURE_CONTRACT = 1;
export const CAPTURE_SUBMIT = "capture.submit";

const httpUrl = z.url({ protocol: /^https?$/i });

/** The share as the receiving device got it, before applying the store's mapping. */
export const CaptureSubmitSchema = z.object({
  version: z.literal(CAPTURE_CONTRACT).optional(),
  captureId: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }),
  source: z.object({ app: z.string().optional() }).optional(),
  text: z.string().optional(),
  url: httpUrl.optional(),
  title: z.string().optional(),
  files: z
    .array(
      z.union([
        z.strictObject({ name: z.string().min(1), mime: z.string(), bytes: z.string() }),
        z.strictObject({ name: z.string().min(1), mime: z.string(), path: z.string() }),
      ]),
    )
    .optional(),
  target: z
    .object({ store: z.string().min(1).optional(), parent: z.string().nullable().optional() })
    .optional(),
});

export const CaptureReceiptSchema = z.object({
  captureId: z.uuid(),
  nodeId: z.string(),
  store: z.string(),
});

export type CaptureSubmit = z.infer<typeof CaptureSubmitSchema>;
export type CaptureReceipt = z.infer<typeof CaptureReceiptSchema>;

export const CAPTURE_PAIR = "capture.pair";
export const CAPTURE_PAIR_CODE = "capture.pairCode";
export const CAPTURE_REVOKE = "capture.revoke";

const CaptureStoreSchema = z.object({ key: z.string(), name: z.string() });

export const CapturePairReceiptSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  store: CaptureStoreSchema,
  captureContract: z.literal(CAPTURE_CONTRACT),
});

/** The HTTP admission layer stamps this from a bearer credential; it is never an input field. */
export const CaptureDeviceDigest = Context.Reference<string | undefined>("kb/CaptureDeviceDigest", {
  defaultValue: () => undefined,
});

export const CaptureVersion = z.object({ captureContract: z.literal(CAPTURE_CONTRACT).optional() });
