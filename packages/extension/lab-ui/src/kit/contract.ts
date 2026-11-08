/**
 * The one contract every lab experiment meets (Lab principles P4).
 *
 * An experiment is a study: metadata the page can show before anything
 * loads (what technique it teaches, which principles it applies, which
 * parameters it exposes), and a scene module, imported only when the study is
 * opened, that mounts into a host element and hands back a handle.
 */
import type { ComponentType } from "react";
import type { LabGraph } from "../lab-graph";
import type { SceneHandle, ScenePalette } from "@kb/scene";
import type { Knob, KnobValue, KnobValues } from "@kb/model";
import type { Timing } from "@kb/ui-sdk";

/** A Lab principle, by its id in DESIGN-UI.md → Lab principles. */
type LabRuleId =
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "M5"
  | "M6"
  | "M7"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "P1"
  | "P2"
  | "P3"
  | "P4"
  | "P5"
  | "T1";

/** A node under the pointer, in host-relative CSS pixels (a study that reads the graph). */
export interface LabHover {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface LabSceneInit {
  readonly palette: ScenePalette;
  readonly dark: boolean;
  readonly reducedMotion: boolean;
  readonly timing: Timing;
  readonly values: KnobValues;
  /** Only a study that reads the graph uses these three. */
  readonly graph: LabGraph;
  readonly onHover: (hover: LabHover | null) => void;
  readonly onOpen: (id: string) => void;
}

/** A mounted study: the scene host's handle, and what only a study is told. */
export interface LabScene extends SceneHandle {
  /** Present only on a study that reads the graph. */
  readonly setGraph?: (graph: LabGraph) => void;
  setPalette(palette: ScenePalette, dark: boolean): void;
  setControl(id: string, value: KnobValue): void;
}

type MountLabScene = (host: HTMLElement, init: LabSceneInit) => Promise<LabScene>;

/** What a study says about itself, shown in its info card. */
export interface LabStudy {
  readonly label: string;
  /** The technique, named. */
  readonly technique: string;
  /** What watching and poking it teaches. */
  readonly teaches: string;
  /** The principles it applies, and how, in this study's own terms. */
  readonly rules: readonly { readonly id: LabRuleId; readonly how: string }[];
  readonly controls: readonly Knob[];
  /**
   * The study draws the graph's lens graph (`LabSceneInit.graph`), so it is
   * shown only while the graph is on (`LabStudyPoint`).
   */
  readonly readsGraph?: true;
  /** Extra teaching UI beside the card (the motion study's curve panel). */
  readonly Panel?: ComponentType<{ readonly values: KnobValues; readonly timing: Timing }>;
  readonly load: () => Promise<MountLabScene>;
}
