/**
 * The CLI's option parsers: each turns one argument into its value or throws
 * the usage error (exit {@link EXIT_USAGE}) commander reports for it.
 */
import { CommanderError } from "commander";

/** What a command exits with when it was called wrong. */
export const EXIT_USAGE = 2;

export const toInt = (v: string): number => Number.parseInt(v, 10);

/** A TCP port, 0 meaning any free one; anything else is a usage error, never NaN. */
export const toPort = (value: string): number => {
  const port = Number(value);
  if (/^\d+$/.test(value) && port <= 65535) return port;
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `a port is a whole number from 0 to 65535 (0: any free port), not ${value}`,
  );
};
/** `kb mcp --session`: the one mode there is, following the person's most recently active tab. */
export const toSessionMode = (value: string): "follow" => {
  if (value === "follow") return value;
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `--session takes follow (each call in the person's most recently active tab), not ${value}`,
  );
};
export const toOrigin = (value: string): string => {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    ) {
      return url.origin;
    }
  } catch {
    // Report malformed URLs through the same CLI usage error as non-origin URLs.
  }
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    "--public-origin must be an HTTP(S) origin, e.g. https://kb.example.com",
  );
};

/**
 * One `--identity-header <header>=<login>`: a header a trusted reverse proxy
 * names the person in, and a login that is them.
 */
const toIdentity = (value: string): { header: string; login: string } => {
  const at = value.indexOf("=");
  const header = value.slice(0, at).trim();
  const login = value.slice(at + 1).trim();
  if (at > 0 && /^[A-Za-z0-9-]+$/.test(header) && login !== "") return { header, login };
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `--identity-header is <header>=<login>, e.g. Tailscale-User-Login=you@github, not ${value}`,
  );
};

/** Every `--identity-header` given, as the one header they name and its logins. */
export const collectIdentity = (
  value: string,
  held: { header: string; people: readonly string[] } | undefined,
): { header: string; people: readonly string[] } => {
  const { header, login } = toIdentity(value);
  if (held === undefined) return { header, people: [login] };
  if (held.header.toLowerCase() !== header.toLowerCase()) {
    throw new CommanderError(
      EXIT_USAGE,
      "commander.invalidArgument",
      `--identity-header names one header, not both ${held.header} and ${header}`,
    );
  }
  return { header: held.header, people: [...held.people, login] };
};

/** How the process is governed (`--governance`): `required` or `off`. */
export const toGovernance = (value: string): "required" | "off" => {
  if (value === "required" || value === "off") return value;
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `--governance is required or off, not ${value}`,
  );
};

/** What `kb ui` was told about where it listens and whom it believes. */
export interface UiListenArguments {
  readonly port?: number;
  readonly socket?: string;
  readonly dev?: boolean;
  readonly devPort?: number;
  readonly publicOrigin?: string;
  readonly identityHeader?: { header: string; people: readonly string[] };
}

/**
 * Refuse a `kb ui` that listens one way and is told another. `--socket` is
 * a hosted listener: its proxy is the way in, so it names that proxy's
 * `--public-origin`, and a port or the dev server does not apply. A trusted
 * `--identity-header` is believed only on a socket, since anything that
 * reaches a TCP port can send the header, while only the socket's owner and
 * root can connect to a socket (DESIGN.md → Action registry → Hosted behind a proxy).
 */
export const checkUiListen = (args: UiListenArguments): void => {
  const usage = (message: string): never => {
    throw new CommanderError(EXIT_USAGE, "commander.conflictingOption", message);
  };
  if (args.socket === undefined) {
    if (args.identityHeader !== undefined) {
      usage("--identity-header is believed only on a --socket its proxy is the one way into");
    }
    return;
  }
  if (args.port !== undefined || args.dev === true || args.devPort !== undefined) {
    usage("--socket listens instead of a port; it takes no --port, --dev or --dev-port");
  }
  if (args.publicOrigin === undefined) {
    usage("--socket is reached through its proxy; name the proxy's --public-origin");
  }
};
