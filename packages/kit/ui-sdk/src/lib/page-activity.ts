/**
 * What has happened on the page, counted since it loaded: changes made
 * elsewhere that it has been shown (another tab, the CLI, the agent's
 * writes), errors it has told the owner of, and turns the sidebar's agent
 * has finished with an answer. The host counts them (`BrowserHost.events`).
 */
export interface PageEvents {
  readonly arrivals: number;
  readonly errors: number;
  readonly turns: number;
}

/**
 * What the owner is doing on the page, as a backdrop may read it
 * (DESIGN-UI.md → Page-head backdrops): whether a node's text is being
 * edited, how many writes the graph has taken, and what has happened on it
 * (`PageEvents`). A backdrop compares a count with the one it last saw, so
 * it needs no listener of its own for app events. Navigation is the `node`
 * it is handed changing.
 */
export interface PageActivity extends PageEvents {
  readonly editing: boolean;
  readonly writes: number;
}

/**
 * A page where the owner does nothing: what art drawn where no owner acts is
 * handed (a backdrop's Appearance card; a veil on the plane that hears no
 * write).
 */
export const QUIET_ACTIVITY: PageActivity = {
  editing: false,
  writes: 0,
  arrivals: 0,
  errors: 0,
  turns: 0,
};
