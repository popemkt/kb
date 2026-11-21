/** `kb ui`: the browser UI's host, and the options that say where it listens and whom it believes. */
import type { Command } from "commander";
import { Effect } from "effect";
import { UI_DEFAULT_PORT } from "@kb/contracts";
import { resolveRootEffect } from "@kb/runtime";
import { ACTION_INVOKE_WIRE, cliAction } from "../command.ts";
import { hostExtensions } from "../host-plugins.ts";
import {
  checkUiListen,
  collectAliasOrigins,
  collectEmbedOrigins,
  collectIdentity,
  collectScripts,
  toPort,
  toPublicOrigin,
} from "./ui-options.ts";

export function uiCommand(program: Command): void {
  program
    .command("ui")
    .description("Serve the kb browser UI + subscription backend")
    .option("--port <n>", "backend listen port, 0 for any free one (default 4321)", toPort)
    .option(
      "--socket <path>",
      "listen on a Unix socket only its owner can connect to (mode 0600), for a proxy on this host; with --public-origin",
    )
    .option("--capture-only", "serve only pairing, capture version and authenticated delivery")
    .option("--dev", "spawn the Vite dev server (HMR) and proxy to the backend", false)
    .option("--dev-port <n>", "Vite dev server port (default 5173)", toPort)
    .option(
      "--public-origin <url>",
      "browser origin when served through a reverse proxy",
      toPublicOrigin,
    )
    .option(
      "--alias-origin <url>",
      "another origin the proxy serves the UI at; links keep --public-origin (repeatable)",
      collectAliasOrigins,
    )
    .option(
      "--embed-origin <url>",
      "let the page at this origin frame kb, and tell it the tab's session (repeatable)",
      collectEmbedOrigins,
    )
    .option(
      "--embed-script <url>",
      "when a page an --embed-origin names frames kb, load this script in kb for it (repeatable)",
      collectScripts,
    )
    .option(
      "--identity-header <header=login>",
      "trust the reverse proxy's <header> to name the person; a request whose header is <login> is theirs (repeatable; with --socket)",
      collectIdentity,
    )
    .option(
      "--watch-extensions",
      "follow edits to this root's own .kb/extensions as they are saved (saved changes need trust again)",
    )
    .option("--no-open", "do not open a browser")
    .action(
      cliAction(
        (
          globals,
          [opts]: [
            {
              port?: number;
              socket?: string;
              dev?: boolean;
              captureOnly?: boolean;
              devPort?: number;
              publicOrigin?: string;
              aliasOrigin?: readonly string[];
              embedOrigin?: readonly string[];
              embedScript?: readonly string[];
              identityHeader?: { header: string; people: readonly string[] };
              watchExtensions?: boolean;
              open?: boolean;
            },
          ],
        ) =>
          Effect.gen(function* () {
            checkUiListen(opts);
            const { identityHeaderIdentity, runUiCli } = yield* Effect.promise(
              () => import("@kb/server"),
            );
            const root = yield* resolveRootEffect({ root: globals.root });
            return yield* runUiCli({
              root,
              port: opts.port ?? UI_DEFAULT_PORT,
              socket: opts.socket,
              openBrowser: opts.open !== false,
              dev: opts.dev === true,
              captureOnly: opts.captureOnly === true,
              devPort: opts.devPort,
              publicOrigin: opts.publicOrigin,
              aliasOrigins: opts.aliasOrigin ?? [],
              embedding: { origins: opts.embedOrigin ?? [], scripts: opts.embedScript ?? [] },
              // The page is the server's owner; a hosted deployment may name
              // the person by the proxy it trusts instead.
              identity:
                opts.identityHeader === undefined
                  ? []
                  : [identityHeaderIdentity(opts.identityHeader)],
              extensions:
                opts.captureOnly === true
                  ? []
                  : yield* hostExtensions(
                      root,
                      opts.publicOrigin ?? `http://127.0.0.1:${opts.port ?? UI_DEFAULT_PORT}`,
                    ),
              openedBy: ACTION_INVOKE_WIRE,
              watchExtensions: opts.watchExtensions === true,
            });
          }),
      ),
    );
}
