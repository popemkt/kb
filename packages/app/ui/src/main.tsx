import { watchForNewBuild } from "@kb/ui-sdk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/components/App";
import { initScrollbarManager } from "@/lib/scrollbar-manager";
import { startDesignSystems } from "@/stores/design-system.store";
import { initPrefs } from "@/stores/prefs.store";
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import "./index.css";

/** Preload the latin Inter Variable subset before React paint (CLS + FOIT). */
function preloadInterLatin() {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[data-kb-font-preload="inter-latin"]')) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.crossOrigin = "anonymous";
  link.href = interLatin;
  link.dataset.kbFontPreload = "inter-latin";
  document.head.appendChild(link);
}

preloadInterLatin();
// A tab left open across a release follows the server into the new build
// (`@kb/ui-sdk` → `lib/stale-build`). The dev server's page is no build.
if (!import.meta.env.DEV) watchForNewBuild();
initPrefs();
startDesignSystems();
// The motion painter paints once the graph has arrived, so it loads with
// it rather than with the page (DESIGN-UI.md → Motion options).
void import("@/stores/motion.store").then(({ startMotion }) => startMotion());
initScrollbarManager();

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
