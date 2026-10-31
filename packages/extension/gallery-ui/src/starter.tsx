import { useState } from "react";
import { WorkspaceState } from "@kb/ui-sdk";
import { addStarter } from "./gallery-api";

/** What an empty store offers: the starter vocabulary, to articulate with from the first minute. */
export function Starter() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <WorkspaceState
        title="A visual composer"
        description={
          "Find references and put the image in your head into words. Visuals are nodes tagged #visual, filed by styles tagged #style under facets tagged #facet, and what you make is a #look. Start with facets of styles (shot, angle, motion, lens, lighting, palette, …), and a dozen public-domain pictures filed by them."
        }
      />
      <button
        type="button"
        disabled={busy}
        data-testid="gallery-starter"
        className="rounded-md border border-border px-3 py-1.5 text-meta text-foreground/75 hover:bg-foreground/5 disabled:opacity-50"
        onClick={() => {
          setBusy(true);
          void addStarter().then(() => setBusy(false));
        }}
      >
        Add the starter library
      </button>
    </div>
  );
}
