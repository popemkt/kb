/**
 * The studio's gallery (DESIGN-UI.md → Backdrop Studio): every backdrop
 * contributed now, whichever family contributes it, as the card Settings
 * draws (`BackdropCard`, a still that mounts once on screen), each opening
 * its own scene. A card shows its backdrop at its fullest, vivid, whatever
 * the page's strength: the gallery shows what each one is, not what the
 * page is set to. On a dark page a card is exposed too (`GalleryExposure`).
 * A repository extension's backdrops are a section of their own, from
 * plugins, beside a card for each repository extension a person has not
 * trusted yet (`PluginExtensions`).
 */
import type { Contribution } from "@kb/plugin";
import type { ExtensionReportRow } from "@kb/contracts";
import {
  BackdropCard,
  navigate,
  useBackdrops,
  usePageBackdrop,
  type Backdrop,
  type RefusedBackdrop,
} from "@kb/ui-sdk";
import { familyOf, sourceOf, type PluginExtensions } from "./plugin-extensions";
import { studioPath } from "./routes";

/** How many times over a dark gallery's card shows what a backdrop lays over its ground. */
const EXPOSURE = 4;
/** The exposure's filter, by id (`backdrops.css` applies it to a dark gallery's cards). */
const EXPOSURE_FILTER = "kb-gallery-exposure";

/**
 * The gallery's exposure: on a dark page, what a backdrop lays over the
 * card's ground counts `EXPOSURE` times over (its alpha, raised), so a wash
 * or a dusk scene, made to sit quietly behind a page's text, reads as
 * itself in a card. A scene that paints its own ground (a GPU scene) is
 * opaque already and shows as it is. Pages never see it.
 */
function GalleryExposure() {
  return (
    <svg aria-hidden="true" className="absolute size-0">
      <filter id={EXPOSURE_FILTER}>
        <feComponentTransfer>
          <feFuncA type="linear" slope={EXPOSURE} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4";

/** One contributed backdrop's card, opening its scene; `from`, the extension it comes from, if a plugin's. */
function GalleryCard({
  backdrop: { key },
  from,
  yours,
}: {
  readonly backdrop: Backdrop;
  readonly from: string | null;
  readonly yours: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        data-studio-card={key.id}
        className="group flex w-full flex-col gap-2 rounded-lg p-1.5 text-left hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => navigate(studioPath(key.id))}
      >
        <BackdropCard id={key.id} strength="vivid" />
        <span className="flex items-baseline gap-2 px-0.5">
          <span className="text-ui font-medium text-foreground/80">{key.label}</span>
          {yours ? <span className="text-label text-primary">your pages</span> : null}
          <span className="flex-1" />
          {(key.knobs?.length ?? 0) > 0 ? (
            <span className="text-label text-foreground/40">{key.knobs?.length} knobs</span>
          ) : null}
        </span>
        {key.credit === undefined && from === null ? null : (
          <span className="px-0.5 text-label text-foreground/40">
            {[key.credit, from === null ? undefined : `from ${from}`]
              .filter((part) => part !== undefined)
              .join(" · ")}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * A contribution kb would not draw (`useBackdrops`' refused): no picture,
 * its name if it gave one, whose it is, and why, so one malformed backdrop
 * is a warning on its own card and every other card is as it was.
 */
function RefusedCard({
  refused,
  from,
}: {
  readonly refused: RefusedBackdrop;
  readonly from: string | null;
}) {
  return (
    <li
      data-studio-refused={refused.id}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-warning/40 p-3"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-ui font-medium text-foreground/80">
          {refused.label ?? refused.id}
        </span>
        <span className="text-label text-warning">can't be shown</span>
      </span>
      {from === null ? null : <span className="text-label text-foreground/50">from {from}</span>}
      <span className="text-label text-foreground/55">
        kb refused what it contributes: {refused.why}. Its other backdrops are unaffected; an update
        to its extension may fix it.
      </span>
    </li>
  );
}

/**
 * A repository extension no one has trusted here: kb runs none of its code,
 * so it draws no picture and names no backdrop, only that it waits on a
 * person, and how they trust it.
 */
function AwaitingCard({ row }: { readonly row: ExtensionReportRow }) {
  return (
    <li
      data-studio-awaiting={row.name}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-foreground/15 p-3"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-ui font-medium text-foreground/80">{row.name}</span>
        <span className="text-label text-warning">needs approval</span>
      </span>
      <span className="text-label text-foreground/50">{sourceOf(row)}</span>
      <span className="text-label text-foreground/55">
        Not trusted on this machine, so kb runs none of its code and cannot show the backdrops it
        may bring. Review it and trust it to see them.
      </span>
      <span className="text-label text-foreground/55">
        Trust it in a terminal with{" "}
        <code className="text-foreground/70">kb ext trust {row.name}</code>; Settings → Extensions
        lists it.
      </span>
    </li>
  );
}

export function StudioGallery({ plugins }: { readonly plugins: PluginExtensions }) {
  const { shown: backdrops, refused } = useBackdrops();
  const page = usePageBackdrop();
  const fromOf = ({ owner }: { readonly owner: string }): string | null => {
    const family = familyOf(owner);
    return plugins.rows.has(family) ? family : null;
  };
  const card = (backdrop: Contribution<Backdrop>) => (
    <GalleryCard
      key={backdrop.value.key.id}
      backdrop={backdrop.value}
      from={fromOf(backdrop)}
      yours={page.backdrop?.value.key.id === backdrop.value.key.id}
    />
  );
  const refusedCard = (backdrop: RefusedBackdrop) => (
    <RefusedCard key={backdrop.id} refused={backdrop} from={fromOf(backdrop)} />
  );
  const own = backdrops.filter((backdrop) => fromOf(backdrop) === null);
  const plugged = backdrops.filter((backdrop) => fromOf(backdrop) !== null);
  const ownRefused = refused.filter((backdrop) => fromOf(backdrop) === null);
  const pluggedRefused = refused.filter((backdrop) => fromOf(backdrop) !== null);
  return (
    <div className="h-full overflow-y-auto" data-studio-gallery="">
      <GalleryExposure />
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-title font-medium text-foreground/85">Backdrops</h1>
          <p className="text-ui text-foreground/55">
            Every backdrop a page head can show. Open one to see it as a scene of its own and tune
            its knobs.
          </p>
        </header>
        <ul className={GRID}>
          {own.map(card)}
          {ownRefused.map(refusedCard)}
        </ul>
        {plugged.length === 0 &&
        pluggedRefused.length === 0 &&
        plugins.awaiting.length === 0 ? null : (
          <section className="flex flex-col gap-3" data-studio-plugins="">
            <h2 className="text-ui font-medium text-foreground/70">From plugins</h2>
            <ul className={GRID}>
              {plugged.map(card)}
              {pluggedRefused.map(refusedCard)}
              {plugins.awaiting.map((row) => (
                <AwaitingCard key={row.name} row={row} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
