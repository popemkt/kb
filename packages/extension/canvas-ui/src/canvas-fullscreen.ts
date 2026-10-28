/**
 * The canvas page in full screen (DESIGN-UI.md → Canvas → The compact
 * stage): the view menu's Full screen. A page cannot turn a phone's screen
 * outside full screen, and in it only where the platform lets it (Android's
 * Chrome does; iOS and a desktop refuse), so the canvas works upright and
 * asks for landscape once it is in full screen, a refusal leaving it as it
 * was.
 */

/** Whether this browser can put an element in full screen (an iPhone's cannot). */
export const fullscreenAvailable = (): boolean =>
  typeof document !== "undefined" && document.fullscreenEnabled;

/** Whether the page is in full screen now. */
export const inFullscreen = (): boolean =>
  typeof document !== "undefined" && document.fullscreenElement !== null;

/** Put `page` in full screen, turned to landscape where that is allowed; or take the page out again. */
export async function toggleFullscreen(page: HTMLElement | null): Promise<void> {
  if (inFullscreen()) {
    await document.exitFullscreen();
    return;
  }
  if (page === null || !fullscreenAvailable()) return;
  await page.requestFullscreen({ navigationUI: "hide" });
  try {
    await screen.orientation.lock("landscape");
  } catch {
    // Refused (a desktop, an unlocked tablet): the canvas stands as the screen does.
  }
}
