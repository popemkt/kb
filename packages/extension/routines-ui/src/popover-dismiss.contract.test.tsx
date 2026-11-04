/**
 * The calendar's popovers, each run through the dismiss contract
 * (`dismissContract`, DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way): the modal every dialog is (the editor, the move prompt), and an
 * instance's popover, which its chip toggles.
 */
import { useState } from "react";
import { afterAll, beforeAll } from "vitest";
import { instantOf, type CalendarEntry } from "@kb/routines";
import { syncUiPlugins } from "@kb/ui-sdk";
import {
  UntilDismissed,
  dismissContract,
  renderPopover,
  testBrowserHost,
  testHostPlugin,
} from "@kb/ui-test-kit";
import { Dialog } from "./dialog";
import { EntryPopover } from "./entry-popover";
import type { CalendarModel } from "./model";

// The popover opens its routine in the outline through its host: here, a test host.
beforeAll(() => syncUiPlugins([testHostPlugin(testBrowserHost())]));
afterAll(() => syncUiPlugins([]));

const ZONE = "Asia/Ho_Chi_Minh";
const START = instantOf("2026-11-04", "09:00", ZONE);
const ENTRY: CalendarEntry = {
  key: "gym/2026-11-04",
  routine: "gym",
  title: "Gym",
  on: "2026-11-04",
  series: true,
  day: "2026-11-04",
  at: "09:00",
  start: START,
  end: START + 3_600_000,
  duration: 60,
  zone: ZONE,
  state: "scheduled",
  occurrence: null,
  calendar: "",
  status: null,
};
const MODEL: CalendarModel = {
  nodes: new Map(),
  calendars: new Map(),
  byDay: new Map(),
  issues: [],
};
const noop = () => {};
const find = (selector: string) => () => document.querySelector(selector);

/** An instance's chip and its popover, as the week holds them: the chip toggles it. */
function Chip() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        data-testid="chip"
        onClick={(event) => {
          const chip = event.currentTarget;
          setElement((now) => (now === null ? chip : null));
        }}
      >
        Gym
      </button>
      {element === null ? null : (
        <EntryPopover
          entry={ENTRY}
          element={element}
          model={MODEL}
          zone={ZONE}
          actions={{ setState: noop, moveOne: noop, edit: noop }}
          onClose={() => setElement(null)}
        />
      )}
    </>
  );
}

dismissContract({
  "packages/extension/routines-ui/src/dialog.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => (
          <Dialog title="Gym" testId="dialog" onClose={dismiss}>
            <p>Body</p>
          </Dialog>
        )}
      </UntilDismissed>,
      find('[data-testid="dialog"]'),
      null,
    ),
  "packages/extension/routines-ui/src/entry-popover.tsx": (host) =>
    renderPopover(host, <Chip />, find('[data-testid="entry-popover"]'), () =>
      document.querySelector<HTMLElement>('[data-testid="chip"]'),
    ),
});
