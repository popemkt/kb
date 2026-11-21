import { Fragment } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { OutlineLine, useOpenNode } from "@kb/ui-sdk";
import type { Crumb } from "./crumbs";

/**
 * The compact ancestor path above a place in References. Each crumb opens
 * its node, matching the page's top breadcrumbs without repeating Home. It
 * keeps to one line: a narrow pane shortens every crumb rather than wrap
 * the path over the rows it names.
 */
export function RowBreadcrumbs({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  const open = useOpenNode();
  if (crumbs.length === 0) return null;

  return (
    <OutlineLine
      depth={0}
      className="mt-2"
      text={
        <div
          className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-caption text-foreground/50"
          data-backlink-breadcrumbs="true"
        >
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.id}>
              {index > 0 && (
                <CaretRightIcon size={9} weight="bold" className="shrink-0 text-foreground/25" />
              )}
              <button
                type="button"
                title={crumb.text}
                className="min-w-0 max-w-[12rem] truncate rounded-xs px-1 py-0.5 first:-ml-1 hover:bg-foreground/5 hover:text-foreground/75 transition-colors duration-100 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  open(crumb.id);
                }}
              >
                {crumb.text}
              </button>
            </Fragment>
          ))}
        </div>
      }
    />
  );
}
