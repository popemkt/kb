/** Code identity is supplied by loading/serving held images, never by graph or request fields. */
type CodeImageIdentity =
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "packaged";
      readonly native: string;
      readonly page: string;
      readonly generation: string;
    };

/** The same image supplies approval identity and executable page bodies, including workers/lazy chunks. */
export interface CodeImagePort {
  readonly identity: CodeImageIdentity;
  /** Opaque logical page filename; no filesystem fallback or path discovery. */
  /** Complete captured closure inventory, supplied by the same loader as pageFile. */
  readonly pageNames: readonly string[];
  readonly pageFile: (name: string) => Blob | null;
}
