import { Fragment } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { OutlineLine, useOpenNode } from "@kb/ui-sdk";
import type { Crumb } from "./crumbs";

/**
 * Compact ancestor path above a backlink or unlinked-mention row. Each crumb
 * opens its node, matching the page's top breadcrumbs without repeating Home.
 */
export function RowBreadcrumbs({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  const open = useOpenNode();
  if (crumbs.length === 0) return null;

  return (
    <OutlineLine
      depth={0}
      className="mt-1.5"
      text={
        <div
          className="flex flex-wrap items-center gap-0.5 text-caption text-foreground/65"
          data-backlink-breadcrumbs="true"
        >
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.id}>
              {index > 0 && (
                <CaretRightIcon size={9} weight="bold" className="shrink-0 text-foreground/30" />
              )}
              <button
                type="button"
                title={crumb.text}
                className="max-w-[12rem] truncate rounded-xs px-1 py-0.5 hover:bg-foreground/5 hover:text-foreground/75 transition-colors duration-100 cursor-pointer"
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
