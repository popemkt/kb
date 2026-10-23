/**
 * This tab's session id (DESIGN.md → Surfaces → The tab's session): minted
 * in the browser the first time the tab asks, and kept in the tab's
 * sessionStorage, so a reload is the same session and another tab is
 * another. The page publishes its screen under it, and every call the page
 * makes is made in it (`inTabSession`), so an agent's call that names it, or
 * that the page makes for it, reaches this tab (`ui.navigate`). It proves
 * nothing and the server never issues it.
 */

import type { ActionRequest } from "@kb/contracts";

const STORAGE_KEY = "kb.tab-session";

/** The id this load holds, once it is minted or read back. */
let held: string | null = null;

function mint(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `kb-${Math.random().toString(36).slice(2)}`;
}

function stored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function keep(id: string): string {
  held = id;
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A tab that cannot keep it still holds it until it reloads.
  }
  return id;
}

/** This tab's session id: the one it keeps, else a fresh one, kept. */
export function tabSession(): string {
  held ??= stored() ?? keep(mint());
  return held;
}

/**
 * A fresh session id for this tab, kept in place of the old one: for a tab
 * whose id another tab already holds (a duplicated tab copies its
 * sessionStorage, and the server refuses the second to publish under it).
 */
export function renewTabSession(): string {
  return keep(mint());
}

/**
 * `call` as this tab makes it: in the session it names, else in this tab's.
 * Every lane the page runs a call on (the local replica, the push) states it.
 */
export function inTabSession<C extends ActionRequest>(call: C): C {
  return call.session === undefined ? { ...call, session: tabSession() } : call;
}
