/**
 * Where a `kb ui` listens (DESIGN.md → Action registry → Hosted behind a
 * proxy): a TCP port on a host, or a Unix socket only its owner can connect
 * to, reached from outside through its proxy at a public origin. The server
 * binds it, and its presence (`.kb/ui.json`) names it, so a process on this
 * machine reaches the server where it listens, whichever kind it is.
 */
export type UiListener =
  | { readonly kind: "tcp"; readonly hostname: string; readonly port: number }
  | {
      readonly kind: "socket";
      readonly path: string;
      /** The proxy's public origin, the one way to the socket and where its page is. */
      readonly origin: string;
    };

/** Where it listens, as a message names it: the TCP listener's address, or the socket's path. */
export function uiListenerName(at: UiListener): string {
  return at.kind === "tcp" ? uiAddressOf(at) : at.path;
}

/** Where the page is: the TCP listener's own address, or the socket's proxy. */
export function uiAddressOf(at: UiListener): string {
  return at.kind === "tcp" ? `http://${at.hostname}:${at.port}` : at.origin;
}
