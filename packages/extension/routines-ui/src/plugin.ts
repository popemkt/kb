import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import {
  RoutinesCalendarView,
  RoutinesEventView,
  RoutinesSyncView,
  routinesDeclarationPlugin,
  routinesExtension,
  SYNC_PATH,
} from "@kb/routines";
import {
  BrowserHostService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";
import { CALENDAR_PATH, matchCalendar, matchSync } from "./routes";
import { CalendarBlankIcon } from "@phosphor-icons/react";
import { CalendarSection, CalendarSurface, EventSurface, SyncSurface } from "./surfaces";

/**
 * The routines calendar: the family's page entry. It loads the family's
 * shared plugin as a child, so the calendar's key reaches the page kernel's
 * catalog from the family as the server's does, and adds the page, its
 * route (`/calendar`) and its sidebar row, an event's own box (the view an
 * `#event` node opens in and previews live), and the sync services page with
 * each service's setup (`/calendar/sync`, and `/calendar/connect`, where
 * Google sends the person back). The family is hosted by `kb ui`
 * and off by default, so all of it exists only while the server reports it
 * on.
 */
export const routinesUiPlugin = definePlugin({
  name: routinesExtension.name,
  tags: familyTags(routinesExtension, "ui"),
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(routinesDeclarationPlugin()),
        ctx.contribute(
          ViewPoint,
          provideView(RoutinesCalendarView, {
            placements: ["page"],
            sample: {},
            Component: CalendarSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: RoutinesCalendarView,
            match: matchCalendar,
            entry: CALENDAR_PATH,
            frame: () => "full",
            pendingTitle: () => "Opening the calendar…",
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(RoutinesEventView, {
            // Its key previews live, so it is offered at `preview` too: the box, at work.
            placements: ["page"],
            picker: { order: 0, icon: CalendarBlankIcon },
            sample: { id: "routines.contract-sample" },
            Component: EventSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(RoutinesSyncView, {
            placements: ["page"],
            sample: {},
            Component: SyncSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: RoutinesSyncView,
            match: matchSync,
            entry: SYNC_PATH,
            frame: () => "full",
            pendingTitle: () => "Opening sync services…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 36, Component: CalendarSection },
        }),
      ],
      { discard: true },
    ),
});
