/**
 * The days family's seed (DESIGN.md → Days): the period tags, the one
 * identity field they template, and the family's settings. Folded after
 * core's nodes by the bundled seed, like every family's.
 */
import { SYSTEM_IDS, seededCommand, seededField, seededTag, type KbNode } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";

const ref = (v: string) => [{ t: "ref" as const, v }];
const CONFIGURES_DAYS: KbNode["props"] = { [SYSTEM_IDS.configuresField]: ref(DAYS_IDS.family) };
/** A setting of the family whose value is a tag (the `day tag` and `week tag`). */
const A_TAG_SETTING: KbNode["props"] = {
  ...CONFIGURES_DAYS,
  [SYSTEM_IDS.targetTagField]: ref(SYSTEM_IDS.tag),
};

function option(id: string, text: string, at: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: at, updatedAt: at };
}

export function daysSeed(at: string): readonly KbNode[] {
  const openOn = seededField(DAYS_IDS.openOnField, "open on", "ref", at, {
    one: true,
    props: CONFIGURES_DAYS,
  });
  const captures = seededField(DAYS_IDS.capturesField, "captures", "ref", at, {
    one: true,
    props: CONFIGURES_DAYS,
  });
  const touched = seededField(DAYS_IDS.touchedField, "made or edited", "ref", at, {
    one: true,
    props: CONFIGURES_DAYS,
  });
  return [
    // The family's identity data: hidden, managed (a person's edit is a
    // deliberate step), and kept to a real period by its guards.
    seededField(DAYS_IDS.keyField, "period", "text", at, {
      one: true,
      hidden: true,
      props: { [SYSTEM_IDS.managedByField]: ref(DAYS_IDS.family) },
    }),
    seededTag(DAYS_IDS.dayTag, "day", [DAYS_IDS.keyField], at),
    seededTag(DAYS_IDS.weekTag, "week", [DAYS_IDS.keyField], at),
    seededTag(DAYS_IDS.yearTag, "year", [DAYS_IDS.keyField], at),
    seededField(DAYS_IDS.journalField, "journal", "ref", at, { one: true, props: CONFIGURES_DAYS }),
    seededField(DAYS_IDS.dayTagField, "day tag", "ref", at, { one: true, props: A_TAG_SETTING }),
    seededField(DAYS_IDS.weekTagField, "week tag", "ref", at, { one: true, props: A_TAG_SETTING }),
    { ...openOn, children: [DAYS_IDS.openOnToday, DAYS_IDS.openOnHome] },
    option(DAYS_IDS.openOnToday, "today", at),
    option(DAYS_IDS.openOnHome, "home", at),
    { ...captures, children: [DAYS_IDS.capturesToday, DAYS_IDS.capturesTop] },
    option(DAYS_IDS.capturesToday, "today", at),
    option(DAYS_IDS.capturesTop, "top level", at),
    { ...touched, children: [DAYS_IDS.touchedHidden, DAYS_IDS.touchedShown] },
    option(DAYS_IDS.touchedHidden, "hidden", at),
    option(DAYS_IDS.touchedShown, "shown", at),
    seededField(DAYS_IDS.timeZoneField, "time zone", "text", at, {
      one: true,
      props: CONFIGURES_DAYS,
    }),
    seededCommand(DAYS_IDS.todayCommand, "Go to today", at),
  ];
}
