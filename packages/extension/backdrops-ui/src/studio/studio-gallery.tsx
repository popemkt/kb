/**
 * The studio's gallery (DESIGN-UI.md → Backdrop Studio): every backdrop
 * contributed now, whichever family contributes it, as the card Settings
 * draws (`BackdropCard`, a still that mounts once on screen), each opening
 * its own scene.
 */
import {
  BackdropCard,
  BackdropPoint,
  navigate,
  useContributions,
  usePageBackdrop,
} from "@kb/ui-sdk";
import { studioPath } from "./routes";

export function StudioGallery() {
  const backdrops = useContributions(BackdropPoint);
  const page = usePageBackdrop();
  return (
    <div className="h-full overflow-y-auto" data-studio-gallery="">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-title font-medium text-foreground/85">Backdrops</h1>
          <p className="text-ui text-foreground/55">
            Every backdrop a page head can show. Open one to see it as a scene of its own and tune
            its knobs.
          </p>
        </header>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {backdrops.map(({ value: { key } }) => (
            <li key={key.id}>
              <button
                type="button"
                data-studio-card={key.id}
                className="group flex w-full flex-col gap-2 rounded-lg p-1.5 text-left hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => navigate(studioPath(key.id))}
              >
                <BackdropCard id={key.id} />
                <span className="flex items-baseline gap-2 px-0.5">
                  <span className="text-ui font-medium text-foreground/80">{key.label}</span>
                  {page.backdrop?.value.key.id === key.id ? (
                    <span className="text-label text-primary">your pages</span>
                  ) : null}
                  <span className="flex-1" />
                  {(key.knobs?.length ?? 0) > 0 ? (
                    <span className="text-label text-foreground/40">{key.knobs?.length} knobs</span>
                  ) : null}
                </span>
                {key.credit === undefined ? null : (
                  <span className="px-0.5 text-label text-foreground/40">{key.credit}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
