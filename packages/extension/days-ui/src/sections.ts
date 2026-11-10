/**
 * The day page's sections (DESIGN-UI.md → Days): what plugins show below a
 * day's own outline, in ascending `order`. Days declares the point and
 * fills two; another family adds its own by contributing here, and days
 * never imports it.
 */
import type { ComponentType } from "react";
import { DAYS_POINT_DEFINITIONS } from "@kb/days";
import { PointName } from "@kb/plugin";

/** What a section is shown for: the day node and its key. */
export interface DaySectionProps {
  readonly id: string;
  readonly day: string;
}

export interface DaySection {
  /** Lower first. */
  readonly order: number;
  /** The section's heading. */
  readonly title: string;
  readonly Component: ComponentType<DaySectionProps>;
}

export const DaySectionPoint = PointName<DaySection>()(DAYS_POINT_DEFINITIONS.sections.name);
