/**
 * DOM Crossfire, drop-in. One script tag turns any page into the arena:
 *   <script src="https://crossfire.domvirus.com/dist/dom-crossfire.js" defer></script>
 * Options as data attributes on that tag:
 *   data-easter-egg="true"   stay hidden until the Konami code (desktop) or a hold-then-tap on any
 *                            [data-crossfire-trigger] element (phones). Default: a PLAY CROSSFIRE key.
 *   data-palette='{"cmd":"#8573ee"}'   Board UI colours (hex only)
 *   data-ride="tank"         fly the plane (default) or drive the tank; the other is your AI partner
 *   data-crossfire-manual    don't auto-install; call window.DomCrossfire.install({...})
 * Escape (or the toggle key) closes it, and the page is exactly as it was.
 */
import { embed, type EmbedConfig } from "../vendor/fizlet/embed";
import { createCrossfire, type Ride } from "./game";

export function install(config: Partial<EmbedConfig> & { ride?: Ride } = {}) {
  return embed(() => (host) => createCrossfire(host, { mode: "embed", ride: config.ride }), {
    name: "crossfire",
    label: "Play Crossfire",
    open: false,
    ...config,
    easterEgg: config.easterEgg ?? false,
  });
}

const tag = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null) : null;
if (tag && tag.dataset.crossfireManual === undefined && /dom-crossfire(\.min)?\.js/.test(tag.src)) {
  let palette: EmbedConfig["palette"];
  try {
    palette = tag.dataset.palette ? JSON.parse(tag.dataset.palette) : undefined;
  } catch {}
  const ride = tag.dataset.ride === "tank" ? "tank" : tag.dataset.ride === "plane" ? "plane" : undefined;
  const ready = () => install({ palette, easterEgg: tag.dataset.easterEgg === "true", ride });
  if (document.body) ready();
  else addEventListener("DOMContentLoaded", ready, { once: true });
}
if (typeof window !== "undefined") (window as unknown as { DomCrossfire: unknown }).DomCrossfire = { install, createCrossfire };
