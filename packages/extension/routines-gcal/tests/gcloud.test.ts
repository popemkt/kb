import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { gcloudSetup, gcloudStatus, type CommandResult } from "../src/index.ts";

/** A gcloud that answers each command by its first words, and records what it ran. */
function gcloud(answers: Readonly<Record<string, Partial<CommandResult>>>) {
  const ran: string[] = [];
  const run = (argv: readonly string[]) => {
    const line = argv.join(" ");
    ran.push(line);
    const key = Object.keys(answers).find((prefix) => line.startsWith(prefix));
    return Promise.resolve({
      code: 0,
      stdout: "",
      stderr: "",
      ...(key === undefined ? {} : answers[key]),
    });
  };
  return { ran, run };
}

const missing = () => Promise.reject(new Error("ENOENT"));
const creating = (stderr: string) => ({
  "gcloud config get-value account": { stdout: "me@example.com" },
  "gcloud projects describe": { code: 1 },
  "gcloud projects create": { code: 1, stderr },
});

test("status reads whether gcloud runs and which account it is signed in as", async () => {
  const signedIn = gcloud({ "gcloud config get-value account": { stdout: "me@example.com\n" } });
  expect(await Effect.runPromise(gcloudStatus(signedIn.run))).toEqual({
    installed: true,
    account: "me@example.com",
  });
  const signedOut = gcloud({ "gcloud config get-value account": { stdout: "(unset)\n" } });
  expect(await Effect.runPromise(gcloudStatus(signedOut.run))).toEqual({
    installed: true,
    account: null,
  });
  expect(await Effect.runPromise(gcloudStatus(missing))).toEqual({
    installed: false,
    account: null,
  });
});

test("setup creates a missing project, then enables the Calendar API on it", async () => {
  const fresh = gcloud({
    "gcloud config get-value account": { stdout: "me@example.com" },
    "gcloud projects describe": { code: 1, stderr: "not found" },
  });
  await Effect.runPromise(gcloudSetup(fresh.run, "kb-routines-me"));
  expect(fresh.ran).toEqual([
    "gcloud config get-value account",
    "gcloud projects describe kb-routines-me --format=value(projectId)",
    "gcloud projects create kb-routines-me --name=kb routines",
    "gcloud services enable calendar-json.googleapis.com --project=kb-routines-me",
  ]);
  const existing = gcloud({ "gcloud config get-value account": { stdout: "me@example.com" } });
  await Effect.runPromise(gcloudSetup(existing.run, "kb-routines-me"));
  expect(existing.ran.some((line) => line.includes("projects create"))).toBe(false);
});

test("a failure says which: signed out, terms not accepted, an id taken", async () => {
  const code = async (answers: Readonly<Record<string, Partial<CommandResult>>>) => {
    const result = await Effect.runPromise(
      Effect.result(gcloudSetup(gcloud(answers).run, "kb-routines-me")),
    );
    return Result.isFailure(result) ? result.failure.code : "ok";
  };
  expect(await code({ "gcloud config get-value account": { stdout: "" } })).toBe(
    "gcloud_signed_out",
  );
  expect(await code(creating("You must accept the Terms of Service"))).toBe("gcloud_terms");
  expect(await code(creating("The project ID you specified is already in use"))).toBe(
    "project_taken",
  );
});
