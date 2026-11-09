/**
 * The setup wizard's calls to its host (`ext.routines.*`, every write one a
 * person makes) and what a failure says, in words a person can act on. A
 * host failure names a code (`SyncError.code`), never a value; this is the
 * one table that reads those codes back as sentences.
 */
import { useEffect, useState } from "react";
import { Option, Schema } from "effect";
import type { ActionReceipt } from "@kb/contracts";
import { browserHost } from "@kb/ui-sdk";

const MESSAGES: Readonly<Record<string, string>> = {
  approval_required: "Only you can do this, from this page.",
  client_id_format: "That isn't a client ID. A client ID ends in .apps.googleusercontent.com.",
  client_secret_format: "Paste the client secret exactly as Google shows it, with no spaces.",
  client_invalid:
    "Google doesn't recognise this client ID and secret. Check that both come from the same client.",
  client_deleted: "This client was deleted in the Console. Create a new one in step 5.",
  client_type: "This client can't be used here. Create one of type Web application.",
  redirect_mismatch: "The client doesn't list kb's redirect URI exactly as shown in step 5.",
  untrusted: "This host doesn't trust the account yet. Press Connect with Google again.",
  connect_expired: "That sign-in expired or was already used. Press Connect with Google again.",
  connect_invalid: "That page wasn't Google's answer to kb's sign-in. Start it again.",
  consent_denied: "The Google sign-in was cancelled. Press Connect with Google to try again.",
  no_refresh_token:
    "Google didn't give kb lasting access. Remove kb routines at myaccount.google.com/permissions, then connect again.",
  auth_needed: "Google refused the connection. Connect again.",
  secret_not_kept: "kb couldn't keep the secret on its host. Check the host's data directory.",
  binding_changed: "The account changed while connecting. Connect again.",
  secrets_foreign:
    "This account names secrets kb's host didn't keep for it. Paste its client again in step 5.",
  offline: "kb's host couldn't reach Google. Check its network and try again.",
  timeout: "Google took too long to answer. Try again.",
  upstream: "Google had a problem answering. Try again in a minute.",
  gcloud_missing: "The Google Cloud CLI (gcloud) isn't installed on kb's host.",
  gcloud_signed_out: "gcloud on kb's host isn't signed in. Run gcloud auth login there first.",
  gcloud_terms: "Accept the Google Cloud terms once at console.cloud.google.com, then try again.",
  project_taken: "That project ID is taken. Pick another one.",
  project_invalid: "Google won't accept that project ID. Pick another one.",
  gcloud_failed: "gcloud couldn't finish. Follow the manual steps below instead.",
  not_found: "That service or calendar no longer exists.",
  invalid_binding: "The account's fields can't be read. Open it in the outline to fix them.",
  graph_unavailable: "kb couldn't save the change. Try again.",
};

/** What a failed receipt says to a person. */
function failureText(receipt: Extract<ActionReceipt, { status: "failed" }>): string {
  return MESSAGES[receipt.message] ?? MESSAGES[receipt.code] ?? receipt.message;
}

/** The outcome of one setup call: its output, or what to tell the person. */
export type Outcome<T> =
  | { readonly ok: true; readonly output: T }
  | { readonly ok: false; readonly error: string };

/** Call `ext.routines.<id>` and read its output as `schema` says it is. */
export async function setupCall<T>(
  id: string,
  input: unknown,
  schema: Schema.Codec<T>,
): Promise<Outcome<T>> {
  const receipt = await browserHost().invoke(`ext.routines.${id}`, input);
  if (receipt.status === "failed") return { ok: false, error: failureText(receipt) };
  const output = Schema.decodeUnknownOption(schema)(receipt.output);
  return Option.isSome(output)
    ? { ok: true, output: output.value }
    : { ok: false, error: "kb's host answered something this page doesn't read. Reload it." };
}

const Digest = Schema.Struct({ digest: Schema.String });

/**
 * Trust a binding as the person, the gesture that approves what it binds:
 * read its digest, then grant it on this host (`sandbox.trust`).
 */
async function trustBinding(node: string): Promise<Outcome<null>> {
  const digest = await setupCall("binding", { node }, Digest);
  if (!digest.ok) return digest;
  const receipt = await browserHost().sandbox.setTrusted(digest.output.digest, true);
  return receipt.status === "succeeded"
    ? { ok: true, output: null }
    : { ok: false, error: failureText(receipt) };
}

/** Start connecting: trust the account's binding as the person, then go to Google. */
export async function startConnect(account: string): Promise<string | null> {
  const trusted = await trustBinding(account);
  if (!trusted.ok) return trusted.error;
  const started = await setupCall("connect", { account }, Schema.Struct({ url: Schema.String }));
  if (!started.ok) return started.error;
  window.location.assign(started.output.url);
  return null;
}

/** Put one calendar on Google: trust its binding, create its Google calendar, trust it again. */
export async function provisionCalendar(calendar: string): Promise<string | null> {
  const first = await trustBinding(calendar);
  if (!first.ok) return first.error;
  const made = await setupCall("provision", { calendar }, Digest);
  if (!made.ok) return made.error;
  const second = await trustBinding(calendar);
  return second.ok ? null : second.error;
}

/** What the host says setting up needs here. */
export const SetupInfo = Schema.Struct({
  redirectUri: Schema.String,
  origin: Schema.String,
  store: Schema.String,
  automation: Schema.Struct({ installed: Schema.Boolean, account: Schema.NullOr(Schema.String) }),
});
export type SetupInfo = typeof SetupInfo.Type;

/** What the host says setting up needs here, asked once per page. */
export function useSetupInfo(): SetupInfo | null {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  useEffect(() => {
    let live = true;
    void setupCall("setup", {}, SetupInfo).then((answer) => {
      if (live && answer.ok) setInfo(answer.output);
    });
    return () => {
      live = false;
    };
  }, []);
  return info;
}

const CONSOLE = "https://console.cloud.google.com";
/** The Console's page at `path`. */
export const consoleUrl = (path: string) => `${CONSOLE}/${path}`;
/** A Console page with the account's project already chosen. */
export const consolePage = (path: string, project: string) =>
  `${consoleUrl(path)}?project=${encodeURIComponent(project)}`;
