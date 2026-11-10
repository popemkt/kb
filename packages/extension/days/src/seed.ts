/**
 * The days family's seed (DESIGN.md → Days): the period tags, the one
 * identity field they template, and the family's two settings. Folded after
 * core's nodes by the bundled seed, like every family's.
 */
import { SYSTEM_IDS, seededCommand, seededField, seededTag, type KbNode } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";

const ref = (v: string) => [{ t: "ref" as const, v }];
const CONFIGURES_DAYS: KbNode["props"] = { [SYSTEM_IDS.configuresField]: ref(DAYS_IDS.family) };

function option(id: string, text: string, at: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: at, updatedAt: at };
}

export function daysSeed(at: string): readonly KbNode[] {
  const openOn = seededField(DAYS_IDS.openOnField, "open on", "ref", at, {
    one: true,
    props: CONFIGURES_DAYS,
  });
  return [
    // GAP [[01M7342WTAZQBARRM7T9F751HT]] the key is the family's identity data, hidden and kept unique, but a person can still write it through debug fields
    seededField(DAYS_IDS.keyField, "period", "text", at, { one: true, hidden: true }),
    seededTag(DAYS_IDS.dayTag, "day", [DAYS_IDS.keyField], at),
    seededTag(DAYS_IDS.weekTag, "week", [DAYS_IDS.keyField], at),
    seededTag(DAYS_IDS.yearTag, "year", [DAYS_IDS.keyField], at),
    seededField(DAYS_IDS.journalField, "journal", "ref", at, { one: true, props: CONFIGURES_DAYS }),
    { ...openOn, children: [DAYS_IDS.openOnToday, DAYS_IDS.openOnHome] },
    option(DAYS_IDS.openOnToday, "today", at),
    option(DAYS_IDS.openOnHome, "home", at),
    seededCommand(DAYS_IDS.todayCommand, "Go to today", at),
  ];
}
