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
