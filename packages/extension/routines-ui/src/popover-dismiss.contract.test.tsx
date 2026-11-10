/**
 * The calendar's popovers, each run through the dismiss contract
 * (`dismissContract`, DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way): the modal every dialog is (the editor, the move prompt), an
 * instance's popover, which its chip toggles, and the editor's day and time
 * pickers, which their fields toggle.
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
import { DateField } from "./date-field";
import { Dialog } from "./dialog";
import { EntryPopover } from "./entry-popover";
import type { CalendarModel } from "./model";
import { TimeField } from "./time-field";

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
          today="2026-11-04"
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
  "packages/extension/routines-ui/src/date-field.tsx": (host) =>
    renderPopover(
      host,
      <DateField label="Day" value="2026-11-04" today="2026-11-04" onChange={noop} />,
      find("[data-date-picker]"),
      () => document.querySelector<HTMLElement>('[aria-label="Day"]'),
    ),
  "packages/extension/routines-ui/src/time-field.tsx": (host) =>
    renderPopover(
      host,
      <TimeField label="Starts" value="09:00" onChange={noop} />,
      find("[data-time-list]"),
      () => document.querySelector<HTMLElement>('[aria-label="Starts"]'),
    ),
  "packages/extension/routines-ui/src/entry-popover.tsx": (host) =>
    renderPopover(host, <Chip />, find('[data-testid="entry-popover"]'), () =>
      document.querySelector<HTMLElement>('[data-testid="chip"]'),
    ),
});
