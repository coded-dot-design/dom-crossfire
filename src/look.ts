// Colours by role from the Board UI kit's tokens (fizlet/ui tokens.json, DOM Battlefield's
// language): the game names roles, never values, so a token change re-tints it.
import { palette } from "../vendor/fizlet/ui/tokens.json";

type Role = { dark: string };
const { roles, surfaces } = palette as unknown as { roles: Record<string, Role>; surfaces: Record<string, Role> };
const all = { ...roles, ...surfaces };
/** Role → its dark-theme value (the canvas layer; the kit's own keys follow the page theme). */
export const ROLE = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.dark])) as Record<
  "sys" | "cmd" | "fire" | "aim" | "attack" | "advance" | "fallin" | "flag" | "go" | "teamA" | "teamB" | "hurt" | "critical" | "bg" | "surface" | "raised" | "card" | "ink" | "muted" | "line" | "rim",
  string
>;
