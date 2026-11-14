import { useMemo } from "react";
import { NoFrame, useFrameSubject, type ViewProps } from "@kb/ui-sdk";
import type { ParamsOf } from "@kb/views";
import {
  CollectionBoardView,
  type CollectionCalendarView,
  CollectionCardsView,
  type CollectionDetailView,
  type CollectionTableView,
} from "@kb/collections";
import { BoardCardsView } from "./board-cards-view";
import { CalendarView } from "./calendar-view";
import { DetailView } from "./detail-view";
import { TableView } from "./table-view";

/** The table view: the frame's rows as one sorted, paged run, a column per field. */
export function TableFrameView({ params }: ViewProps<ParamsOf<typeof CollectionTableView>>) {
  const subject = useFrameSubject();
  if (subject === null) return <NoFrame />;
  return <TableView frame={subject} settings={params} />;
}

/** The board view: the frame's rows as cards, a column per value of its group field. */
export function BoardFrameView({ params }: ViewProps<ParamsOf<typeof CollectionBoardView>>) {
  const subject = useFrameSubject();
  const view = useMemo(() => ({ key: CollectionBoardView, params }), [params]);
  if (subject === null) return <NoFrame />;
  return <BoardCardsView frame={subject} view={view} />;
}

/** The cards view: the frame's rows as cards in one grid. */
export function CardsFrameView({ params }: ViewProps<ParamsOf<typeof CollectionCardsView>>) {
  const subject = useFrameSubject();
  const view = useMemo(() => ({ key: CollectionCardsView, params }), [params]);
  if (subject === null) return <NoFrame />;
  return <BoardCardsView frame={subject} view={view} />;
}

/** The detail view: the frame's rows as a list beside one row's page. */
export function DetailFrameView({ params }: ViewProps<ParamsOf<typeof CollectionDetailView>>) {
  const subject = useFrameSubject();
  if (subject === null) return <NoFrame />;
  return <DetailView frame={subject} params={params} />;
}

/** The calendar view: the frame's rows on the days of a date field, the undated ones beside them. */
export function CalendarFrameView({ params }: ViewProps<ParamsOf<typeof CollectionCalendarView>>) {
  const subject = useFrameSubject();
  if (subject === null) return <NoFrame />;
  return <CalendarView frame={subject} params={params} />;
}
