import { lazy } from "react";
import { CalendarDotsIcon } from "@phosphor-icons/react";
import { RoutinesCalendarView, type CalendarParams } from "@kb/routines";
import {
  navigate,
  paramsOf,
  SidebarRow,
  SidebarSection,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { CALENDAR_PATH } from "./routes";

/** The page stays in the calendar's own chunk. */
const CalendarPage = lazy(() =>
  import("./calendar-page").then((m) => ({ default: m.CalendarPage })),
);

export function CalendarSurface({ params }: ViewProps<CalendarParams>) {
  return (
    <ViewErrorBoundary
      title="Calendar crashed"
      resetKey={`calendar|${params.mode ?? ""}|${params.date ?? ""}`}
    >
      <CalendarPage params={params} />
    </ViewErrorBoundary>
  );
}

export function CalendarSection({ route }: { readonly route: MatchedRoute | null }) {
  return (
    <SidebarSection>
      <SidebarRow
        label="Calendar"
        icon={<CalendarDotsIcon size={14} />}
        active={paramsOf(route, RoutinesCalendarView) !== null}
        onClick={() => navigate(CALENDAR_PATH)}
      />
    </SidebarSection>
  );
}
