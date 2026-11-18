import { expect, test } from "bun:test";
import { CAPTURE_CONTRACT, CaptureSubmitSchema, type CaptureSubmit } from "../src/capture.ts";

test("raw capture v1 accepts an offset, mixed content, and explicit top level", () => {
  const input = {
    version: CAPTURE_CONTRACT,
    captureId: "dbd51958-cbd2-4e31-bc08-cb2866042800",
    capturedAt: "2026-11-18T23:48:00+07:00",
    source: { app: "Browser" },
    title: "Source title",
    url: "https://example.com/path",
    text: "Line one\nLine two",
    files: [
      { name: "capture.png", mime: "image/png", bytes: "YQ==" },
      { name: "paper.pdf", mime: "application/pdf", path: "assets/01ABC.pdf" },
    ],
    target: { parent: null },
  } satisfies CaptureSubmit;
  expect(CaptureSubmitSchema.parse(input)).toEqual(input);
  expect(CaptureSubmitSchema.safeParse({ ...input, version: 2 }).success).toBe(false);
  expect(CaptureSubmitSchema.safeParse({ ...input, url: "file:///etc/passwd" }).success).toBe(
    false,
  );
});
