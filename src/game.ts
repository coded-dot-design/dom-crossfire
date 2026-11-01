/**
 * DOM Crossfire: a co-op mashup on Battlefield Blitz's engine setup, Board UI, HUD and feel.
 * Pick the PLANE or the TANK; the other one flies or drives beside you as an AI partner. The bad
 * guys of the first four DOM VIRUS games come at you in waves:
 *   1 SWARM PROTOCOL  bugs that eat the board's letters and grow (6 letters, then 12: a hunter)
 *   2 NULL INVADERS   button factories that keep releasing aliens until you break them
 *   3 SHERMAN BYTES   enemy tank squads holding fortified button bases (four walls, a core)
 *   4 BYTE RUNNER     flies and the frog eat the pellets on the board's blocks and grow; a big
 *                     frog's tongue eats a plane or a tank whole
 * Each army is a section of four waves (more, faster, tougher, a mini-boss on the fourth), then
 * the finale: all four at once.
 * The plane is fast and flies over cover: its guns shred the air and the factories, but barely
 * scratch armour or walls. The tank is slow and tough: its cannon breaches walls and wrecks tanks,
 * and its treads squash small bugs. Co-op is the point: each one covers what the other can't.
 *
 * Two modes, as in Blitz:
 *   board - its own page: a grid arena, four sections of four waves and the finale, shared reinforcements (DROPS), a result.
 *   embed - dropped onto any page: the page is the arena, shells knock its headings about, the
 *           waves loop. Escape (or the toggle) closes it and the page is untouched.
 *
 * Every random number comes from the engine's seeded random, so a seed replays a match, and the
 * step allocates nothing (typed registers, pools, no closures or strings in the step: Blitz's K4).
 */
import { createEngine } from "../vendor/fizlet/index";
import type { presence as Presence, Transport } from "../vendor/fizlet/presence";

// Squad play's lockstep (@fzlt/core/presence) is registered by the net build (src/net.ts →
// dist/dom-crossfire-net.mjs), so the drop-in and the solo module don't carry it (Blitz's split).
let lockstep: typeof Presence | null = null;
export function useLockstep(p: typeof Presence) {
  lockstep = p;
}
import { controls } from "../vendor/fizlet/input";
import { effects } from "../vendor/fizlet/fx";
import { sound } from "../vendor/fizlet/sound";
import { inRect } from "../vendor/fizlet/collide";
import { launch, slam } from "../vendor/fizlet/ui/board-ui";
import { drops } from "../vendor/fizlet/rules";
import { tankSprites, shipSprites, alienSprites, flySprites, bugSprites, frogSprites, shipSvg, tankSvg, factionSvg } from "./art";

/** The Board UI kit CSS (Fizlet's ui brick), minified and baked in by scripts/build.mjs. */
declare const __KIT_CSS__: string;

export type Ride = "plane" | "tank";
export interface CrossfireResult { won: boolean; score: number; wave: number; ride: Ride; kills: number; surrendered: boolean }
export interface CrossfireOptions {
  mode?: "board" | "embed";
  /** Your ride (default: the last pick on the start screen, else the plane). The other is your AI partner. */
  ride?: Ride;
  /** Attract mode: both rides are AI, no HUD or keys, the waves loop (a landing-page hero). */
  demo?: boolean;
  /** Seed for the match's randomness (engine.random). Same seed + same input = the same match. */
  seed?: number;
  /** Waves to win a board match. Default 17 (four sections of four, then the finale). */
  waves?: number;
  /** Called when a board match ends. */
  onEnd?: (r: CrossfireResult) => void;
  /** Squad play (co-op, 2 to 4 people) in lockstep over @fzlt/core/presence: every peer runs the same
   *  match from the room's seed and only inputs cross the wire. Each person picks the plane or the tank
   *  (`ride`, agreed in the countdown); a squad of two keeps the AI partner, three or four don't. A
   *  fixed 1100 × 640 arena, scaled to fit. `input` replaces this peer's controls (tests). */
  net?: { transport: Transport; slot: number; players: number; delay?: number; input?: () => number; leave?: () => void };
}

const TAU = Math.PI * 2;
/** Give an object's fractional fields the double representation from the start (keys space-separated):
 *  a field V8 first saw as a small integer changes its map when it first holds a fraction, and every
 *  step compiled against the old map deoptimizes (the step then allocates until it re-optimizes). */
function dbl<T extends object>(o: T, keys: string): T {
  const r = o as Record<string, number>;
  for (const k of keys.split(" ")) {
    const v = r[k]!;
    r[k] = 0.5;
    r[k] = v;
  }
  return o;
}
/** Length of (x, y) without Math.hypot's allocation (Blitz: bit for bit what V8's hypot returns). */
function dist(x: number, y: number) {
  if (x < 0) x = -x;
  if (y < 0) y = -y;
  const m = x > y ? x : y, r = x > y ? y / m : x / m;
  return m === 0 ? 0 : m * Math.sqrt(1 + r * r);
}
// The two rides. Index = kind.
const TANK = 0, PLANE = 1;
const RIDE_NAME = ["TANK", "PLANE"];
const RIDE_COLOR = ["#39ffb0", "#19f0ff"];
const MAXHP = [6, 4], RAIL_MAX = 9, STRIKE_MAX = 5;
// Foes. Air foes (aliens, flies) fly; ground foes (bugs, tanks) don't.
const BUG = 1, ALIEN = 2, ETANK = 3, FLY = 4, FROG = 5;
const FOE_NAME = ["", "BUG", "ALIEN", "TANK", "FLY", "FROG"];
const ETANK_COLOR = "#ff8a1f";
// Sites: Null Invaders' button factories and Sherman Bytes' fortified button bases.
const FACTORY = 1, BASE = 2;
const LABELS = ["SIGN UP", "BUY NOW", "SUBSCRIBE", "SUBMIT", "CHECKOUT", "DOWNLOAD"];
// Who hurts what (× damage): rows = the shooter's ride; columns = bug, alien, tank, fly, factory, core, wall.
// The plane shreds the air and factories; the tank breaches walls and wrecks armour.
const HURT = [
  [1, 0.5, 1.5, 0.5, 0.6, 1, 1],
  [1, 1, 0.34, 1, 1, 0.3, 0.2],
];
const H_FACTORY = 4, H_CORE = 5, H_WALL = 6;
// Power tiles (Blitz's blinking grid).
const RAPID = 1, TRIPLE = 2, STRIKE = 3, SHIELD = 4, MINE = 5, HEAL = 6, AMMO = 7;
const TILE_COLOR = ["", "#39ffb0", "#19f0ff", "#ff2e88", "#f6f3ff", "#ff2b4e", "#a8ff3e", "#ffc21a"];
const COLORS = ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a", "#b48cff", "#ff8a1f", "#a8ff3e", "#f6f3ff"];
const WORDS = ["BOOM", "KABOOM", "WRECKED", "DIRECT HIT", "BLAM", "SQUASHED", "AIRSTRIKE!", "RAPID", "TRIPLE", "SHIELD", "+1 STRIKE", "MINE!", "+2 HP", "+1 LONG", "SNIPED", "SUPPLY DROP", "CARPET BOMB", "OVERHEAT", "LOCKED", "MEDKIT", "+2 LONG", "JACKPOT", "BREACH!", "BASE TAKEN", "FACTORY DOWN", "POWER!", "+100", "+200", "+300", "+400", "GROWN", "HUNTER", "TWIN", "TRIDENT", "OVERDRIVE", "+1 HP", "CHOMP", "WAVE CLEAR", "REPAIR", "EATEN!", "GULP", "BOSS DOWN"];
const W_BOOM = 0, W_SQUASH = 5, W_STRIKE = 6, W_MINE = 11, W_SNIPED = 14, W_SUPPLY = 15, W_CARPET = 16, W_HOT = 17, W_LOCK = 18, W_BREACH = 22, W_TAKEN = 23, W_FACTORY = 24, W_POWER = 25, W_EAT = 26, W_GROWN = 30, W_HUNTER = 31, W_TIER = 30, W_HP1 = 35, W_CHOMP = 36, W_CLEAR = 37, W_REPAIR = 38, W_EATEN = 39, W_GULP = 40, W_BOSS = 41;
const TILE_WORD = [0, 7, 8, 10, 9, 11, 12, 13];
const CRATE_WORD = [19, 20, 10, 21];
const FX_COLORS = ["#fff4ff", "#ffc21a", "#ff8a1f", "#ff2e88", "#19f0ff", "#39ffb0", "#9a63ff", "#07060f", "#a8ff3e", "#b48cff"];
const STREAK = ["", "", "", "+1 LONG SHOT", "", "+1 AIRSTRIKE", "", "", "CARPET BOMB READY"];
const TIER_NAME = ["", "PULSE", "TWIN", "TRIDENT", "OVERDRIVE"];
// Null Invaders' weapon tiers: XP to unlock, and the cadence (160 ms → 95 ms).
const TIER_XP = [0, 0, 12, 40, 90], TIER_COOL = [0, 0.16, 0.14, 0.12, 0.095];
// The sections: name, colour, what happens, the plane's job, the tank's job, the fourth wave's mini-boss.
export const FACTIONS = [
  ["SWARM PROTOCOL", "#b48cff", "Bugs eat the letters and grow. Twelve letters and they hunt you.", "PICK THEM OFF FROM THE AIR", "SQUASH THE SMALL ONES", "THE QUEEN"],
  ["NULL INVADERS", "#19f0ff", "Every button is a factory. Break it or the aliens never stop.", "BREAK THE FACTORIES", "COVER THE PLANE", "THE MOTHERSHIP"],
  ["SHERMAN BYTES", "#ffc21a", "Squads hold fortified button bases. Breach the walls, take the button.", "CLEAR THE SKY, STRAFE THE SQUADS", "BREACH THE WALLS", "THE HEAVY"],
  ["BYTE RUNNER", "#a8ff3e", "The pellets on the blocks are theirs: every one eaten makes them stronger. A big frog eats rides.", "KILL THEM BEFORE THEY EAT", "WATCH THE FROG'S TONGUE", "THE BIG FROG"],
  ["CROSSFIRE", "#ff2e88", "All four at once. Stick together.", "AIR AND FACTORIES", "WALLS AND GROUND", ""],
] as const;
const SHORT = ["SWARM", "INVADERS", "SHERMAN", "BYTE RUN", "CROSSFIRE"];
// Four sections of four waves, then the finale (wave 17).
const PER = 4, FINALE = 17;
// The board's copy: the four games' taglines, for the bugs to eat.
const COPY = ["PROTECT EVERY LAST BYTE", "DELETE THE INVASION", "EVERY PAGE IS A BATTLEFIELD", "FOLLOW THE BITES", "EAT THE PAGE", "THE VIRUS SCRAMBLED THE CARTRIDGES"];

interface Unit {
  i: number; kind: number; name: string; color: string;
  /** Drawn as yours (this screen). */
  you: boolean;
  /** Driven by a person (this screen's, or a squad mate's over the network); else the AI. */
  human: boolean;
  x: number; y: number; a: number; ta: number; vx: number; vy: number;
  hp: number; alive: boolean; dead: number; drop: number; shield: number; rapid: number; triple: number;
  strikes: number; carpet: number; rail: number; charge: number; chargeT: number; heat: number; hot: number;
  cool: number; kills: number; deaths: number; recoil: number; flash: number; tread: number; run: number;
  gx: number; gy: number; think: number; target: number; xp: number; tier: number; bite: number;
  /** Trigger pulls so far (a volley counts once): tests read it, since a shell can stop on cover the frame it's fired. */
  shots: number;
}
interface Foe {
  on: boolean; kind: number; sub: number; x: number; y: number; a: number; ta: number; vx: number; vy: number;
  hp: number; max: number; t: number; think: number; gx: number; gy: number; flash: number; eaten: number;
  tier: number; home: number; mode: number; cool: number; tread: number; recoil: number; food: number; u: number; boss: number;
}
interface Site { on: boolean; kind: number; x: number; y: number; w: number; h: number; hp: number; max: number; t: number; label: number; won: boolean; flash: number; cool: number; out: number }
interface Shell { x: number; y: number; vx: number; vy: number; life: number; owner: number; on: boolean; rail: boolean; tgt: number; foe: boolean; kind: number }
interface Tile { c: number; r: number; type: number; roll: number; t: number; on: boolean }
interface Block { x: number; y: number; w: number; h: number; hp: number; back: number; site: number }
interface Mark { x: number; y: number; t: number; max: number; owner: number; on: boolean }
interface Bomber { x: number; y: number; vx: number; vy: number; a: number; t: number; owner: number; on: boolean }
interface Bomb { x: number; y: number; wait: number; fall: number; owner: number; main: boolean; on: boolean }
interface Boom { x: number; y: number; t: number; p: number; c: number; on: boolean }
interface Cover { el: HTMLElement; x: number; y: number; w: number; h: number; busy: number }
// Shell kinds: the tank's cannon, the plane's guns, the long shot / salvo (rail), an alien bolt, an enemy tank shell, base flak.
const K_SHELL = 0, K_BOLT = 1, K_RAIL = 2, K_ALIEN = 3, K_ETANK = 4, K_FLAK = 5;

const ICON = {
  fire: '<path d="M10 1v5M10 14v5M1 10h5M14 10h5"/><circle cx="10" cy="10" r="5"/>',
  long: '<circle cx="10" cy="10" r="7"/><path d="M10 1v6M10 13v6M1 10h6M13 10h6"/><circle cx="10" cy="10" r="1" fill="currentColor"/>',
  salvo: '<path d="M5 17V7l2-4 2 4v10M11 17V7l2-4 2 4v10M4 17h12"/>',
  strike: '<path d="M10 1.5l1.6 5.2 6.4 3.6v1.6l-6.3-1.4-.7 4.3 2.3 1.9v1.3l-3.3-.9-3.3.9v-1.3l2.3-1.9-.7-4.3L2 11.9v-1.6l6.4-3.6z"/>',
  auto: '<path d="M10 1v4M10 15v4M1 10h4M15 10h4M5.5 5.5l2 2M14.5 5.5l-2 2M5.5 14.5l2-2M14.5 14.5l-2-2"/>',
  lock: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M10 8v4M8 10h4"/>',
  pause: '<path d="M7 4v12M13 4v12"/>',
  full: '<path d="M2 7V2h5M18 7V2h-5M2 13v5h5M18 13v5h-5"/>',
  exit: '<path d="M7 2v5H2M13 2v5h5M7 18v-5H2M13 18v-5h5"/>',
  info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6v.5"/>',
};
const GRID = '<path d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64" stroke="#19f0ff" stroke-opacity=".35"/><rect x="1" y="1" width="62" height="62" fill="none" stroke="#19f0ff" stroke-width="2"/>';
// The DOM VIRUS skull on its grid tile, crossed by two pink tracer lines: Crossfire's mark.
const BADGE = `<svg class="ic" viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<g transform="translate(10 9) scale(.69)" fill="currentColor"><path fill-rule="evenodd" d="M19 6h26v6h7v6h6v6h5v22h-5v6h-8v12h-9v-8h-6v8h-8v-8h-6v8h-8V52H5v-6H0V24h5v-6h6v-6h8ZM11 29v14h15V29Zm26 0v14h15V29Z"/></g><path d="M4 56 56 4M8 60 60 8" stroke="#ff2e88" stroke-width="3"/></svg>`;
const CELLS = [0, 1, 4, 2, 5, 8, 3, 6, 9, 12, 7, 10, 13, 11, 14, 15].map((i, k) => `<rect x="${(i % 4) * 16}" y="${((i / 4) | 0) * 16}" width="16" height="16" style="--i:${k}"/>`).join("");
const FLAG = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><g class="bui-cells">${CELLS}</g><path class="bui-grid" d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64"/><rect class="bui-frame" x="1" y="1" width="62" height="62"/><path class="bui-pole" d="M17 9h4v46h-4Z"/><path class="bui-cloth" d="M21 12h24l-6 9 6 9H21Z"/></svg>`;
const PLAY = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M22 16v32l26-16Z" fill="currentColor"/></svg>`;
const AGAIN = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M30 12v8a13 13 0 1 0 13 13h6a19 19 0 1 1-19-19Zm0-2 10 9-10 8Z" fill="currentColor"/></svg>`;
const MENU = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M16 18h32v6H16Zm0 11h32v6H16Zm0 11h32v6H16Z" fill="currentColor"/></svg>`;
const svg = (k: keyof typeof ICON) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON[k]}</svg>`;

// A phone: a coarse pointer on a small screen (the same query as Blitz's game mode).
const PHONE = "(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 500px)";
// Blitz's CSS, kept where it is the same game (HUD, keys, pad, stick, overlays, phone layout), plus
// Crossfire's own: the ride picker, the wave card, the partner readout.
const CSS = `:host{all:initial;display:block}*{box-sizing:border-box}
.bz{position:absolute;inset:0;overflow:hidden;font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;touch-action:none;user-select:none;-webkit-user-select:none}
.bz.embed{position:fixed;z-index:2147483000}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.aiming canvas{cursor:none}
.hud{position:absolute;left:50%;top:max(10px,env(safe-area-inset-top));translate:-50% 0;display:flex;gap:14px;align-items:center;padding:8px 14px;background:color-mix(in srgb,var(--surface) 93%,transparent);border:2px solid var(--line);border-radius:12px;box-shadow:0 5px 0 var(--rim);pointer-events:none;white-space:nowrap}
.hud b{font-size:17px;font-weight:900}.hud small{display:block;font-size:8px;letter-spacing:.16em;color:var(--muted)}
.hud .sc b{color:var(--team)}.hud .wv b{color:var(--wc,var(--k-sys-ink))}.hud .dr b{color:var(--k-fire-ink)}
.bui[data-theme=light] .hud .sc b{color:#0a8a55}
.hud i{display:block;width:64px;height:10px;margin-top:4px;background:var(--raised);border:1.5px solid var(--rim);border-radius:3px;overflow:hidden}
.hud u{display:block;height:100%;background:var(--team);transition:width .2s}.hud .low u{background:var(--k-fire)}
.hud .pt u{background:var(--pc)}.hud .pt i{width:44px}.hud .pt small{color:var(--pc)}.hud .pt.out{opacity:.45}
.feed{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(70px,calc(env(safe-area-inset-top) + 60px));margin:0;padding:0;list-style:none;display:grid;gap:4px;justify-items:end;pointer-events:none}
.feed li{padding:4px 8px;color:var(--ink);background:color-mix(in srgb,var(--surface) 90%,transparent);border:1px solid var(--line);border-radius:6px;font-size:11px}.feed li:empty{display:none}
.feed i{font-style:normal;font-weight:900;text-shadow:0 0 1px var(--rim)}
.banner{position:absolute;left:50%;top:max(80px,calc(env(safe-area-inset-top) + 70px));translate:-50% 0;display:grid;justify-items:center;gap:4px;padding:10px 22px 12px;background:#10233f;border:3px solid #f6f3ff;border-radius:14px;box-shadow:0 6px 0 #f6f3ff;rotate:-2deg;pointer-events:none;opacity:0;white-space:nowrap}
.banner b{font:900 clamp(20px,4vw,34px)/1 ui-monospace,monospace;letter-spacing:.05em;color:#ffc21a}.banner span{font-size:11px;letter-spacing:.18em;color:#19f0ff}
.wave{position:absolute;left:50%;top:50%;translate:-50% -50%;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:6px 18px;width:min(560px,calc(100% - 28px));padding:16px 22px 18px 16px;color:#f6f3ff;background:#10233f;border:4px solid #f6f3ff;border-radius:16px;box-shadow:0 8px 0 #f6f3ff,0 0 60px color-mix(in srgb,var(--fc) 35%,transparent);rotate:-2deg;pointer-events:none;opacity:0}
.wave .art{grid-row:span 3;display:grid;place-items:center;width:84px;height:84px;padding:8px;background:#07060f;border:3px solid var(--fc);border-radius:12px}.wave .art svg{width:100%;height:100%}
.wave small{font:900 11px/1 ui-monospace,monospace;letter-spacing:.22em;color:#19f0ff}.wave b{font:900 clamp(26px,5vw,42px)/1 ui-monospace,monospace;letter-spacing:.02em;color:var(--fc)}
.wave p{margin:0;font:600 12px/1.4 ui-monospace,monospace;color:#cfd3ef}.wave .jobs{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.wave .jobs span{padding:5px 9px;font:900 10px/1 ui-monospace,monospace;letter-spacing:.1em;color:#07060f;background:var(--c);border:2px solid #07060f;border-radius:6px;box-shadow:0 3px 0 #07060f}
.tip{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));translate:-50% 0;padding:8px 14px;font-size:11px;letter-spacing:.12em;color:var(--rim);background:var(--k-attack);border:2px solid var(--rim);border-radius:8px;box-shadow:0 4px 0 var(--rim);pointer-events:none;white-space:nowrap;animation:blink 1s steps(2) infinite}
.tip[hidden]{display:none}@keyframes blink{50%{opacity:.6}}
.pad{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:200px;height:256px;pointer-events:none;transform-origin:100% 100%}
.embed .pad{bottom:max(80px,calc(env(safe-area-inset-bottom) + 64px))}
.bui .pad .grab{top:auto;left:auto;translate:none;right:60px;bottom:224px;pointer-events:auto}
.bui .rk{--py:5px;position:absolute;display:grid;place-content:center;justify-items:center;gap:2px;width:62px;height:62px;min-height:0;padding:0;border-width:2.5px;border-radius:50%;pointer-events:auto;touch-action:none}
.bui .rk svg{width:24px;height:24px;stroke-width:2.3}
.rk small{font:900 8px/1 ui-monospace,monospace;letter-spacing:.12em}
.rk .n{position:absolute;top:-7px;right:-7px;min-width:24px;height:24px;padding:0 6px;font:900 12px/20px ui-monospace,monospace;color:var(--ink);background:var(--surface);border:2px solid var(--c);border-radius:12px}
.bui .rk kbd{position:absolute;left:-6px;top:-6px;margin:0;padding:1px 4px;font:800 8px/1.3 ui-monospace,monospace;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:4px;opacity:1}
.bui .fire{width:96px;height:96px;right:30px;bottom:0}.bui .fire kbd{left:50%;top:auto;bottom:-8px;translate:-50% 0}.bui .fire svg{width:40px;height:40px}
.fire::after{content:"";position:absolute;inset:-9px;border-radius:50%;background:conic-gradient(var(--hurt) calc(var(--h,0) * 1turn),transparent 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));pointer-events:none}
.fire.hot::after{background:var(--k-fire);animation:blink .25s steps(2) infinite}
.bui .long{--c:var(--hurt);right:85px;bottom:150px}.bui .strike{--lock:var(--k-attack);right:9px;bottom:150px}
.bui :is(.lock,.auto){width:52px;height:52px}.bui .auto{right:92px;bottom:84px}.bui .lock{right:12px;bottom:84px}.bui :is(.lock,.auto) svg{width:20px;height:20px}
.demo .hud,.demo .pad,.demo .help,.demo .feed,.demo .banner,.demo .tip,.demo .wave{display:none}.demo canvas{cursor:default}
.help{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));max-width:calc(100% - 240px);padding:6px 10px;font-size:10px;letter-spacing:.08em;color:var(--muted);background:color-mix(in srgb,var(--surface) 85%,transparent);border-radius:8px;pointer-events:none}
.over{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:26px;background:color-mix(in srgb,#2a2d38 72%,transparent)}
.over[hidden]{display:none}
.over.intro{padding-top:64px;background:radial-gradient(closest-side,color-mix(in srgb,var(--bg) 70%,transparent),transparent)}
.sticker{position:relative;display:flex;gap:14px;align-items:center;padding:10px 20px 12px 14px;color:var(--rim);background:var(--k-flag);border:3px solid var(--rim);border-radius:12px;box-shadow:0 6px 0 var(--rim);rotate:-4deg;animation:bui-slam 1.1s linear both;pointer-events:none}
.sticker .ic{display:block;width:62px;height:62px;padding:3px;color:#19f0ff;background:#10233f;border-radius:7px}
.sticker span{position:absolute;top:-14px;right:-12px;padding:4px 8px 3px;font:900 11px/1 ui-monospace,monospace;letter-spacing:.1em;white-space:nowrap;background:var(--k-attack);border:2.5px solid var(--rim);border-radius:6px;box-shadow:0 3px 0 var(--rim);rotate:10deg}
.sticker b{font:900 clamp(34px,7vw,58px)/1 ui-monospace,monospace;letter-spacing:3px;white-space:nowrap;text-shadow:0 4px 0 #07060f59}
.sticker b em{font-style:normal;color:#ff2e88;text-shadow:0 4px 0 #8f195066}
.bui .bui-sticker-key{animation:pop .38s .9s var(--bui-spring) both}.bui .bui-sticker-key svg [stroke]{stroke:currentColor}.bui .bui-sticker-key b{animation:blink 1s steps(2) infinite}
@keyframes pop{from{scale:.4;opacity:0}}
.pick{display:grid;justify-items:center;gap:8px}
.pick>small{font:900 10px/1 ui-monospace,monospace;letter-spacing:.22em;color:var(--muted)}
.rides{display:flex;gap:14px;justify-content:center;max-width:calc(100vw - 24px)}
.bui .ride{position:relative;display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:12px;width:236px;min-height:0;padding:10px 14px 10px 10px;text-align:left;--py:6px}
.ride .pic svg,.wave .art svg{stroke:none}.ride .pic{grid-row:span 2;display:grid;place-items:center;width:56px;height:56px;padding:5px;background:#07060f;border:2px solid var(--rim);border-radius:9px}.ride .pic svg{width:100%;height:100%}
.ride b{font:900 18px/1 ui-monospace,monospace;letter-spacing:.14em}.ride small{font-size:10px;line-height:1.35;letter-spacing:.02em;color:var(--muted);text-transform:none}
.bui .ride[aria-pressed=true]{border-color:var(--rc);background:color-mix(in srgb,var(--rc) 16%,var(--card));box-shadow:0 2px 0 var(--rim),0 0 26px color-mix(in srgb,var(--rc) 35%,transparent)}.ride[aria-pressed=true] small{color:var(--ink);opacity:.85}.ride[aria-pressed=true] b{color:var(--rc)}.bui[data-theme=light] .ride[aria-pressed=true] b{color:var(--ink)}.ride[aria-pressed=true] .pic{border-color:var(--rc)}
.ride .you{position:absolute;top:-11px;right:10px;padding:3px 7px 2px;font:900 9px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--rim);background:var(--k-go);border:2px solid var(--rim);border-radius:5px;opacity:0;scale:.6;transition:opacity .15s,scale .15s}
.ride[aria-pressed=true] .you{opacity:1;scale:1}
.mate{margin:-6px 0 0;font:900 11px/1.3 ui-monospace,monospace;letter-spacing:.12em;color:var(--k-sys-ink);text-align:center}
.bui .ov [data-resume]{width:168px;height:96px}.bui .ov [data-resume] b{font-size:13px}
.ov.pause .bui-overlay-keys{flex-wrap:wrap;justify-content:center;width:min(640px,calc(100% - 24px));bottom:max(20px,env(safe-area-inset-bottom))}
.ov .by{flex-basis:100%;margin:0;text-align:center;font-size:10px;letter-spacing:.14em;color:#f6f3ff}.ov .by a{display:inline-block;padding:8px 2px;color:var(--k-sys)}
.ov .table{position:absolute;left:50%;top:56%;translate:-50% -50%}.ov.result .bui-sticker{top:24%}
.bui :is(.fs,.dk){position:absolute;z-index:3;left:calc(max(12px,env(safe-area-inset-left)) + var(--bz-lead,0px));top:max(10px,env(safe-area-inset-top));width:40px;height:40px;min-height:0}.embed .fs,.demo .fs{display:none}
.bz.full{position:fixed;z-index:2147483000}
.bui .pz{position:absolute;z-index:3;left:calc(max(12px,env(safe-area-inset-left)) + var(--bz-lead,0px) + 48px);top:max(10px,env(safe-area-inset-top));display:inline-flex;align-items:center;gap:6px;height:40px;min-height:0;padding:0 12px}.demo .pz,.pre .pz,.net .pz{display:none}
.pz svg{width:18px;height:18px;stroke:currentColor;stroke-width:3.2;fill:none}
@media (pointer:coarse){.pz span{display:none}.bui :is(.fs,.pz,.dk){width:44px;height:44px;padding:0;justify-content:center}.bui .pz{left:calc(max(12px,env(safe-area-inset-left)) + var(--bz-lead,0px) + 52px)}.pz svg{width:22px;height:22px}}
@media (max-height:460px){.ov .table{top:57%;gap:2px;padding:6px 12px;font-size:10px}.ov.result .bui-sticker{top:20%}}
.pre .hud,.pre .pad,.pre .help,.pre .feed,.aiming .help{display:none}
@media (max-height:520px){.bz:not(.nofs) .legend{display:none}.over.intro{padding-top:0;gap:14px}.sticker b{font-size:34px}.sticker .ic{width:44px;height:44px}.ride .pic{width:40px;height:40px}.bui .ride{width:210px;padding-block:6px}.ride small{display:none}.mate{margin:0}.pick{gap:6px}}
.table{display:grid;gap:4px;min-width:260px;padding:12px 16px;color:var(--ink);background:var(--surface);border:2px solid var(--line);border-radius:12px;box-shadow:0 5px 0 var(--rim)}
.table div{display:flex;justify-content:space-between;gap:20px}.table .you{color:var(--team)}.bui[data-theme=light] .table .you{color:#0a8a55}.table .big{font-size:15px;font-weight:900;padding-bottom:4px;border-bottom:1px solid var(--line)}
.count{font:900 96px/1 ui-monospace,monospace;color:var(--ink);text-shadow:0 0 30px var(--k-sys);animation:bui-slam .5s both}
.legend{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;translate:-50% 0;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;width:max-content;max-width:calc(100% - 128px);padding:8px 16px;font-size:11px;color:var(--muted);background:color-mix(in srgb,var(--surface) 93%,transparent);border:2px solid var(--line);border-radius:10px;box-shadow:0 4px 0 var(--rim)}
.legend b{color:var(--ink)}.legend i{font-style:normal;font-weight:900;color:var(--c)}
@media (max-width:620px){.pad{scale:.82}.hud{gap:9px;padding:6px 10px}.hud .wv small{letter-spacing:.08em}.help{display:none}
.hud{top:max(62px,calc(env(safe-area-inset-top) + 52px))}.feed{top:max(122px,calc(env(safe-area-inset-top) + 112px))}.banner{top:max(132px,calc(env(safe-area-inset-top) + 122px))}
.over.intro{grid-template-columns:min(100%,400px);align-content:safe center;gap:22px;padding:max(64px,calc(env(safe-area-inset-top) + 54px)) 16px 16px}
.nofs .legend{display:grid;justify-content:start;left:16px;right:16px;translate:none;width:auto;max-width:none}
.sticker{margin:12px 0;width:max-content}.rides{flex-direction:column;gap:12px;width:100%}.bui .ride{width:100%}.wave{grid-template-columns:1fr;justify-items:center;text-align:center}.wave .art{grid-row:auto;width:64px;height:64px}.wave .jobs{justify-content:center}
.bui .intro [data-go]{width:168px;height:96px;margin-top:4px}}
.nofs .fs,.bz .dk,.bz .legend[hidden]{display:none}.nofs:not(.demo,.embed) .dk{display:grid}.nofs .legend{top:max(64px,calc(env(safe-area-inset-top) + 54px));background:var(--surface);animation:dsl .2s}
@media (pointer:fine){.touch-only{display:none}}@media (pointer:coarse){.fine-only,.bui .rk kbd{display:none}}
@keyframes dsl{from{opacity:0;margin-top:-8px}}@media (prefers-reduced-motion:reduce){.sticker,.count,.tip,.nofs .legend{animation:none}}
.stk{display:none}
@media ${PHONE}{.stk{position:absolute;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));display:block;width:116px;height:116px;border:2.5px solid var(--line);border-radius:50%;background:color-mix(in srgb,var(--surface) 55%,transparent);touch-action:none}
.stk::before{content:"";position:absolute;inset:-28px;border-radius:50%}
.stk i{position:absolute;left:31px;top:31px;width:50px;height:50px;background:var(--team);border:2.5px solid var(--rim);border-radius:50%;box-shadow:0 4px 0 var(--rim)}
.pre .stk,.demo .stk,.bui .pad .grab{display:none}.bui :is(.auto,.lock){bottom:106px;width:56px;height:56px}.bui :is(.long,.strike){bottom:166px}.hud{translate:-50% 0!important;background:color-mix(in srgb,var(--surface) 80%,transparent)}.pad{translate:none!important}
.feed{left:50%;right:auto;translate:-50% 0;justify-items:center}.feed li:nth-child(n+3){display:none}}`;

export function createCrossfire(host: HTMLElement, o: CrossfireOptions = {}) {
  const net = o.net ?? null, P = net ? net.players : 0;
  const mode = net ? "board" : o.mode ?? "board", embed = mode === "embed", demo = !net && !!o.demo;
  if (net && o.seed === undefined) throw new Error("Crossfire squad play needs the room's seed");
  if (net && !lockstep) throw new Error("Crossfire squad play: import createCrossfire from dom-crossfire-net.mjs");
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = __KIT_CSS__ + CSS;
  const wrap = document.createElement("div");
  wrap.className = `bui bz ${mode}${demo ? " demo" : ""}${net ? " net" : ""}`;
  wrap.dataset.theme = "dark";
  wrap.innerHTML = `<canvas></canvas>
<div class="hud"><div class="sc"><small>SCORE</small><b data-sc>0</b></div><div class="wv"><small data-wl>WAVE</small><b data-wv>1/5</b></div><div class="hp"><small data-hn>ARMOR</small><i><u data-hp></u></i></div><div class="pt"><small data-pn>PARTNER</small><i><u data-php></u></i></div><div class="dr"><small>DROPS</small><b data-dr>4</b></div></div>
<ol class="feed"><li></li><li></li><li></li><li></li></ol>
<div class="banner" data-banner><b></b><span></span></div>
<div class="wave" data-wave role="status" aria-live="polite"></div>
<div class="tip" data-tip hidden>AIRSTRIKE · <span class="fine-only">CLICK</span><span class="touch-only">TAP</span> WHERE THE BOMBS GO</div>
<button class="bui-icon-key fs" type="button" data-fs aria-label="Full screen" title="Full screen">${svg("full")}</button>
<button class="bui-icon-key dk" type="button" data-dir aria-label="Directions" aria-expanded="false" aria-controls="cf-dir">${svg("info")}</button>
<button class="bui-arcade bui-flag pz" type="button" data-pause aria-label="Pause (Esc or P)" title="Esc · P · Pause">${svg("pause")}<span>PAUSE</span></button>
<div class="stk" data-stk aria-hidden="true"><i></i></div>
<div class="pad" data-pad>
<button class="bui-grip grab" type="button" data-grab aria-label="Move the controls: drag (double-click puts them back)" title="Drag to move · double-click to reset"></button>
<button class="rk bui-arcade bui-aim auto" type="button" data-k="auto" aria-pressed="false" aria-label="Auto-aim at the nearest enemy (Q)" title="Q · Auto-aim">${svg("auto")}<small>AUTO</small><kbd>Q</kbd></button>
<button class="rk bui-arcade bui-aim lock" type="button" data-k="lock" aria-pressed="false" aria-label="Aim lock: stick to one target, tap an enemy to switch (T)" title="T · Aim lock">${svg("lock")}<small>LOCK</small><kbd>T</kbd></button>
<button class="rk bui-arcade bui-attack strike" type="button" data-k="strike" aria-pressed="false" aria-label="Airstrike: then tap where the bombs go (F)" title="F · Airstrike">${svg("strike")}<small>STRIKE</small><span class="n" data-n="strike">1</span><kbd>F</kbd></button>
<button class="rk bui-arcade long" type="button" data-k="long" aria-label="Long shot (E)" title="E · Long shot"><span data-li>${svg("long")}</span><small data-ll>LONG</small><span class="n" data-n="long">3</span><kbd>E</kbd></button>
<button class="rk bui-arcade bui-fire fire" type="button" data-k="fire" aria-label="Hold to fire (Space)" title="Space · Fire">${svg("fire")}<kbd>SPACE</kbd></button>
</div>
<div class="help fine-only" data-help></div>
<div class="over" data-over hidden></div>
<div class="legend" id="cf-dir" hidden></div>
<div class="bui-overlay ov" data-ov hidden role="dialog"></div>`;
  root.append(style, wrap);
  const $ = <T extends Element>(s: string) => wrap.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>("canvas"), ctx = canvas.getContext("2d")!;
  const over = $<HTMLElement>("[data-over]"), tip = $<HTMLElement>("[data-tip]"), banner = $<HTMLElement>("[data-banner]"), waveCard = $<HTMLElement>("[data-wave]");
  const keys = {
    fire: $<HTMLButtonElement>("[data-k=fire]"), long: $<HTMLButtonElement>("[data-k=long]"), strike: $<HTMLButtonElement>("[data-k=strike]"),
    auto: $<HTMLButtonElement>("[data-k=auto]"), lock: $<HTMLButtonElement>("[data-k=lock]"),
  };
  const hud = {
    sc: $<HTMLElement>("[data-sc]"), wv: $<HTMLElement>("[data-wv]"), wl: $<HTMLElement>("[data-wl]"), dr: $<HTMLElement>("[data-dr]"), hp: $<HTMLElement>("[data-hp]"), hn: $<HTMLElement>("[data-hn]"),
    php: $<HTMLElement>("[data-php]"), pn: $<HTMLElement>("[data-pn]"), sn: $<HTMLElement>("[data-n=strike]"), ln: $<HTMLElement>("[data-n=long]"),
  };
  const feed = [...wrap.querySelectorAll<HTMLLIElement>(".feed li")];

  const e = createEngine({ root: wrap, seed: o.seed ?? (Math.random() * 1e9) | 0, events: 128 }); // port-check: ok setup: the seed when none is given, before any step
  const input = controls(e, {
    keys: {
      up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], fire: ["Space"],
      long: ["KeyE", "KeyR"], strike: ["KeyF", "KeyX"], auto: ["KeyQ"], lock: ["KeyT"], pause: ["Escape", "KeyP"],
    },
    target: canvas,
    stick: "left",
  });
  const fx = effects({ cap: 760, words: WORDS, colors: FX_COLORS, scorch: 48 });
  // Effects the step asks for, played in render (Blitz: the step stages them in FQ and queues them).
  const FX_SPAWN = 0, FX_WORD = 1, FX_BLAST = 2, FXN = 12, FXCAP = 512;
  const FQ = new Float64Array(FXN - 1), fxq = new Float64Array(FXN * FXCAP);
  let fxLen = 0;
  function fxPush(op: number) {
    if (fxLen < FXCAP) {
      const at = fxLen++ * FXN;
      fxq[at] = op;
      fxq.set(FQ, at + 1);
    }
    FQ.fill(0);
  }
  function fxPlay() {
    for (let i = 0; i < fxLen; i++) {
      const q = i * FXN, op = fxq[q];
      if (op === FX_SPAWN) fx.spawn(fxq[q + 1]!, fxq[q + 2]!, fxq[q + 3]!, fxq[q + 4]!, fxq[q + 5]!, fxq[q + 6]!, fxq[q + 7]!, fxq[q + 8]!, fxq[q + 9]!, fxq[q + 10]!);
      else if (op === FX_WORD) fx.word(fxq[q + 1]!, fxq[q + 2]!, fxq[q + 3]!, fxq[q + 4]!, fxq[q + 5]! || 16);
      else fx.blast(fxq[q + 1]!, fxq[q + 2]!, fxq[q + 3]!, fxq[q + 4]!);
    }
    fxLen = 0;
  }
  const sfx = sound(e, { cues: { shot: "fire", bolt: "click", boom: "boom", hit: "hit", power: "power", strike: "hurt", land: "click", lock: "click", win: "win", end: "end", ready: "ready", streak: "win", wave: "ready", chomp: "click" } });
  const drawTank = tankSprites(document), drawShip = shipSprites(document), drawAlien = alienSprites(document), drawFly = flySprites(document), drawBug = bugSprites(document), drawFrog = frogSprites(document);
  const R = e.random;
  // The screen's own random (the shake): seeded off the match's seed, drawn only by render.
  const shakeSeed = new Uint32Array([(R.state ^ 0x9e3779b9) >>> 0]);
  const shakeRandom = () => ((shakeSeed[0] = Math.imul(shakeSeed[0]!, 1664525) + 1013904223), shakeSeed[0]! / 4294967296);
  // The match's running numbers, stored in place (a double in a closure variable is a new heap number per write).
  const G = new Float64Array(24);
  const CNT = 0, MATCH = 1, TILE_IN = 2, CRATE_IN = 3, QUAKE = 4, WAVE = 5, PHASE = 6, PH_T = 7, SCORE = 8, DROPS = 9, LVL = 10, FROGS_LEFT = 11;
  const BUGS_LEFT = 12, BUG_IN = 13, FLIES_LEFT = 14, FLY_IN = 15, RES = 16, KILLS = 17, WAVE_T = 18, OUT_T = 19, PLAYED = 20, DTS = 21;
  // Phases of a wave: its card (no spawns), the fight, cleared (a beat, then the next card).
  const P_CARD = 0, P_FIGHT = 1, P_CLEAR = 2;
  const RESUME = 3, WAVES = o.waves ?? FINALE;
  G[DROPS] = 4;
  const coarse = matchMedia("(pointer: coarse)"), fine = matchMedia("(pointer: fine)"), phone = matchMedia(PHONE);
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let shook = 0;

  // ---------- World ----------
  let W = 0, H = 0, dpr = 1, scale = 1.4, T = 44, cols = 0, rows = 0, area = 1;
  let state: "intro" | "count" | "play" | "end" | "paused" = embed || demo ? "play" : "intro";
  const saved = (() => {
    try {
      return localStorage.getItem("crossfire:ride") ?? "";
    } catch {
      return "";
    }
  })();
  let ride: number = (o.ride ?? (saved === "tank" ? "tank" : "plane")) === "tank" ? TANK : PLANE;
  const mkUnit = (i: number): Unit => dbl({
    i, kind: 0, name: "", color: "", you: false, human: false, x: 0, y: 0, a: -Math.PI / 2, ta: -Math.PI / 2, vx: 0, vy: 0, hp: 0, alive: false, dead: 0.4 + i * 0.5, drop: 0,
    shield: 0, rapid: 0, triple: 0, strikes: 1, carpet: 0, rail: 3, charge: 0, chargeT: -1, heat: 0, hot: 0, cool: 0, kills: 0, deaths: 0,
    recoil: 0, flash: 0, tread: 0, run: 0, gx: 0, gy: 0, think: 0, target: -1, xp: 0, tier: 1, bite: 0, shots: 0,
  }, "x y a ta vx vy hp dead drop shield rapid triple charge heat hot cool recoil flash tread gx gy think xp bite");
  /** The crew: up to four humans (squad play) and the AI partner. Solo: you (crew[0]) and the AI
   *  (crew[1]). A squad of two keeps an AI partner as the third ride; three or four play alone.
   *  CN is how many are in the match. The seam: pilot() is the one place a ride's controls come from. */
  const crew: Unit[] = Array.from({ length: 5 }, (_, i) => mkUnit(i));
  // presence's step hands every person's input word for the frame here (squad play), then runs world().
  let netIn: Uint32Array = new Uint32Array(Math.max(1, P));
  let CN = 2, you = crew[0]!, mate = crew[1]!;
  // Squad seats: humans in slot order with their seat colours, then (two humans) the AI partner.
  const SEAT = ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a"];
  /** The squad's roster from each person's ride (bit 9 of their input word, agreed in the countdown). */
  function seat() {
    CN = P === 2 ? 3 : P;
    let planes = 0;
    for (let i = 0; i < P; i++) planes += (netIn[i]! >>> 9) & 1;
    for (let i = 0; i < CN; i++) {
      const u = crew[i]!, hu = i < P;
      // The AI partner takes the ride the two humans have fewer of (a tie: the one P1 didn't pick).
      u.kind = hu ? (netIn[i]! >>> 9) & 1 : planes === 1 ? 1 - ((netIn[0]! >>> 9) & 1) : planes ? TANK : PLANE;
      u.human = hu;
      u.you = i === net!.slot;
      u.name = hu ? `P${i + 1}` : RIDE_NAME[u.kind]!;
      u.color = hu ? SEAT[i]! : RIDE_COLOR[u.kind]!;
      u.hp = MAXHP[u.kind]!;
      u.rail = u.kind === PLANE ? 2 : 3;
    }
    you = crew[net!.slot]!;
    mate = crew[net!.slot ? 0 : 1]!;
  }
  function cast() {
    if (net) return seat();
    you.kind = ride;
    mate.kind = 1 - ride;
    for (let i = 0; i < CN; i++) {
      const u = crew[i]!;
      (u.name = RIDE_NAME[u.kind]!), (u.color = RIDE_COLOR[u.kind]!), (u.you = u === you && !demo), (u.human = u === you && !demo), (u.hp = MAXHP[u.kind]!), (u.rail = u.kind === PLANE ? 2 : 3);
    }
  }
  cast();
  const MAXF = 80;
  const foes: Foe[] = Array.from({ length: MAXF }, () => dbl({ on: false, kind: 0, sub: 0, x: 0, y: 0, a: 0, ta: 0, vx: 0, vy: 0, hp: 0, max: 1, t: 0, think: 0, gx: 0, gy: 0, flash: 0, eaten: 0, tier: 1, home: -1, mode: 0, cool: 0, tread: 0, recoil: 0, food: -1, u: 0, boss: 0 }, "x y a ta vx vy hp max t think gx gy flash cool tread recoil u"));
  const SITES = 6;
  const sites: Site[] = Array.from({ length: SITES }, () => dbl({ on: false, kind: 0, x: 0, y: 0, w: 0, h: 0, hp: 0, max: 1, t: 0, label: 0, won: false, flash: 0, cool: 0, out: 0 }, "x y w h hp max t flash cool"));
  const shells: Shell[] = Array.from({ length: 200 }, () => dbl({ x: 0, y: 0, vx: 0, vy: 0, life: 0, owner: 0, on: false, rail: false, tgt: -1, foe: false, kind: 0 }, "x y vx vy life"));
  const tiles: Tile[] = Array.from({ length: 22 }, () => dbl({ c: 0, r: 0, type: 0, roll: 0, t: 0, on: false }, "roll t"));
  const marks: Mark[] = Array.from({ length: 8 }, () => dbl({ x: 0, y: 0, t: 0, max: 1, owner: 0, on: false }, "x y t max"));
  const bombers: Bomber[] = Array.from({ length: 6 }, () => dbl({ x: 0, y: 0, vx: 0, vy: 0, a: 0, t: 0, owner: 0, on: false }, "x y vx vy a t"));
  const bombs: Bomb[] = Array.from({ length: 40 }, () => dbl({ x: 0, y: 0, wait: 0, fall: 0, owner: 0, main: false, on: false }, "x y wait fall"));
  const booms: Boom[] = Array.from({ length: 48 }, () => dbl({ x: 0, y: 0, t: 0, p: 0, c: 0, on: false }, "x y t p"));
  // Base walls: 4 per base, kept at the end of `blocks` (cover first), live while the wave lasts.
  const blocks: Block[] = [];
  let coverN = 0;
  // The board's copy (the letters bugs eat): position, character, eaten (shows 0 or 1), who has it reserved.
  const GCAP = 200;
  const gx = new Float64Array(GCAP), gy = new Float64Array(GCAP), gch = new Uint16Array(GCAP), gate = new Uint8Array(GCAP), gres = new Int16Array(GCAP).fill(-1);
  let glyphs = 0;
  // Byte Runner's pellets: food for its flies and its frog, set on the board's blocks.
  const PCAP = 32;
  const pelX = new Float64Array(PCAP), pelY = new Float64Array(PCAP), pelOn = new Uint8Array(PCAP), pelBack = new Float64Array(PCAP);
  let pellets = 0;
  const CRATE_FALL = 170, CRATE_DROP = 2.2;
  const supply = drops(e, { kinds: ["repair", "long", "strike", "jackpot"], cap: 2, life: 14 + CRATE_DROP, fall: CRATE_FALL, speed: CRATE_FALL / CRATE_DROP });
  let covers: Cover[] = [], coverDirty = true, coverAt = 0;
  const anims = new Set<Animation>();
  let lightTheme = false;
  let autoOn = coarse.matches, lockOn = false, lockT = -1, targeting = false;
  let strikeQ = false, strikeX = 0, strikeY = 0, longQ = false, strikeT = false, fireQ = false;
  // Messages for the DOM, written in render: the feed ring (who, what), the banner, the wave card.
  const feedK = new Int16Array(8), feedV = new Int16Array(8);
  let feedN = 0, feedShown = 0, bannerN = 0, bannerShown = 0, bannerKind = 0, bannerV = 0, waveN = 0, waveShown = 0;

  // Squad play: every peer plays the same 1100 × 640 arena, scaled to fit its screen (the view:
  // scale, offset x, offset y). Drawing and input only; the match never knows. Solo: identity.
  // A phone held upright turns the arena (view[3]), so its long side runs down the tall screen (Blitz).
  const view = new Float64Array([1, 0, 0, 0]);
  const wx = (x: number, y = input.pointer.y) => (view[3] ? y - view[2]! : x - view[1]!) / view[0]!, wy = (y: number, x = input.pointer.x) => (view[3] ? H - (x - view[1]!) / view[0]! : (y - view[2]!) / view[0]!);
  /** Text about (x, y) reads upright on a turned view. */
  const upright = (x: number, y: number) => view[3] && (ctx.translate(x, y), ctx.rotate(-Math.PI / 2), ctx.translate(-x, -y));
  function resize() {
    const r = wrap.getBoundingClientRect();
    if (net) {
      if (!cols) (W = 1100), (H = 640), (scale = 1.45), (T = 44), (cols = 25), (rows = 14), (area = 1), layBlocks();
      const cw = Math.max(320, r.width), ch = Math.max(240, r.height);
      dpr = Math.min(devicePixelRatio || 1, cw < 760 ? 1.5 : 2);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const turn = (view[3] = +(phone.matches && ch > cw)), aw = turn ? H : W, ah = turn ? W : H;
      view[0] = Math.min(cw / aw, ch / ah);
      view[1] = (cw - aw * view[0]) / 2;
      view[2] = (ch - ah * view[0]) / 2;
      return;
    }
    W = Math.max(320, r.width);
    H = Math.max(240, r.height);
    dpr = Math.min(devicePixelRatio || 1, W < 760 ? 1.5 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scale = W < 600 ? 1.05 : W < 1000 ? 1.25 : 1.45;
    T = W < 600 ? 36 : 44;
    cols = Math.floor(W / T);
    rows = Math.floor(H / T);
    area = Math.max(0.5, Math.min(1.3, (W * H) / (1100 * 640)));
    if (!embed) layBlocks();
    else if (!blocks.length) for (let k = 0; k < 8; k++) blocks.push(dbl({ x: 0, y: 0, w: 0, h: 0, hp: 0, back: 0, site: -2 }, "x y w h hp back"));
    coverDirty = true;
  }
  /** Cover blocks (Blitz's), the 8 wall slots after them, and the board's copy. */
  function layBlocks() {
    blocks.length = 0;
    const n = Math.round((cols * rows) / 40);
    for (let k = 0; k < n; k++) {
      const c = 1 + Math.floor(R() * (cols - 2)), r = 3 + Math.floor(R() * (rows - 5)), long = R() < 0.4;
      blocks.push(dbl({ x: c * T + 3, y: r * T + 3, w: (long ? 2 : 1) * T - 6, h: T - 6, hp: 3, back: 0, site: -1 }, "x y w h hp back"));
    }
    coverN = blocks.length;
    for (let k = 0; k < 8; k++) blocks.push(dbl({ x: 0, y: 0, w: 0, h: 0, hp: 0, back: 0, site: -2 }, "x y w h hp back"));
    // The copy: lines of the four games' taglines, set like a page in the open rows. Not in the
    // attract match: behind a landing's headline it would only be clutter.
    glyphs = 0;
    if (demo) return;
    const cw = Math.round(T * 0.27), lines = Math.max(3, Math.min(7, Math.floor(rows / 2.2)));
    for (let l = 0; l < lines && glyphs < GCAP; l++) {
      const text = COPY[(l + Math.floor(R() * COPY.length)) % COPY.length]!, len = text.length * cw;
      const x0 = T + Math.floor(R() * Math.max(1, W - len - 2 * T)), y0 = ((l + 0.5) / lines) * (H - 120) + 90;
      for (let k = 0; k < text.length && glyphs < GCAP; k++) {
        const ch = text.charCodeAt(k);
        if (ch === 32) continue;
        gx[glyphs] = x0 + k * cw;
        gy[glyphs] = y0;
        gch[glyphs] = ch;
        gate[glyphs] = 0;
        gres[glyphs] = -1;
        glyphs++;
      }
    }
  }
  // The step's number registers (Blitz, K4): a double passed to a call V8 doesn't inline is boxed.
  const F = new Float64Array(32);
  const BX = 0, BY = 1, BR = 2, TF = 3, TT = 4, TM = 5, TO = 6, DX = 7, DY = 8, DT = 9, SX = 10, SY = 11, SR = 12, HX = 13, HY = 14, HO = 15, KX = 16, KY = 17, QX = 18, QY = 19, LAST = 20, AX = 21, AY = 22, WT = 23, SPD = 24, GRIP = 25, SA = 26, SS = 27, SL = 28, PU = 29, AMT = 30;
  function hyp() {
    F[HO] = dist(F[HX]!, F[HY]!);
  }
  /** The live block (or live site, when `solid`) a circle at (F[BX], F[BY]) of radius F[BR] touches, or null. */
  function blockedF() {
    const cx = F[BX]!, cy = F[BY]!, r = F[BR]!;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.hp <= 0) continue;
      const x = b.x, y = b.y, w = b.w, h = b.h;
      const dx = cx - (cx < x ? x : cx > x + w ? x + w : cx), dy = cy - (cy < y ? y : cy > y + h ? y + h : cy);
      if (dx * dx + dy * dy < r * r) return b;
    }
    return null;
  }
  /** A live site's box under the circle (F[BX], F[BY], F[BR]): -1 when clear. */
  function siteAt() {
    const cx = F[BX]!, cy = F[BY]!, r = F[BR]!;
    for (let i = 0; i < SITES; i++) {
      const s = sites[i]!;
      if (!s.on || s.hp <= 0) continue;
      const x = s.x - s.w / 2, y = s.y - s.h / 2, w = s.w, h = s.h;
      const dx = cx - (cx < x ? x : cx > x + w ? x + w : cx), dy = cy - (cy < y ? y : cy > y + h ? y + h : cy);
      if (dx * dx + dy * dy < r * r) return i;
    }
    return -1;
  }
  const solid = () => blockedF() !== null || siteAt() >= 0;

  // ---------- Page as cover (embed): measured in the read phase only when the page moved ----------
  const SEL = "h1,h2,h3,h4,p,li,img,button,blockquote,figure,pre,table,input,textarea,[role=button]";
  addEventListener("scroll", () => (coverDirty = true), { signal: e.signal, passive: true, capture: true });
  addEventListener("resize", () => (coverDirty = true), { signal: e.signal });
  function measureCovers() {
    covers = [];
    for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
      if (covers.length >= 90 || el.closest("[data-fizlet-host]")) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 12 || b.height < 8 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
      covers.push({ el, x: b.left, y: b.top, w: b.width, h: b.height, busy: 0 });
    }
  }
  function knock(c: Cover, nx: number, ny: number, power: number, flat: boolean) {
    if (G[MATCH]! < c.busy || typeof c.el.animate !== "function") return;
    c.busy = G[MATCH]! + (flat ? 1.1 : 0.8);
    const p = Math.min(2, power), dx = nx * 18 * p, dy = ny * 14 * p - 10 * p, spin = (nx >= 0 ? 1 : -1) * (6 + R() * 10) * p;
    const a = c.el.animate(
      flat
        ? [{ transform: "none" }, { transform: "scale(1.06,.35)", offset: 0.2 }, { transform: "scale(1.06,.35)", offset: 0.6 }, { transform: "scale(.96,1.08)", offset: 0.82 }, { transform: "none" }]
        : [{ transform: "none" }, { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg)`, offset: 0.3 }, { transform: `translate(${dx * 0.2}px,0) rotate(${-spin * 0.2}deg)`, offset: 0.7 }, { transform: "none" }],
      { duration: flat ? 1000 : 760, easing: "cubic-bezier(.2,.9,.3,1.2)" },
    );
    anims.add(a);
    a.onfinish = a.oncancel = () => anims.delete(a);
  }
  function knockAround(x: number, y: number, rad: number, power: number) {
    if (!embed) return;
    for (const c of covers) {
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2, d = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
      if (d < rad) knock(c, (cx - x) / (d || 1), (cy - y) / (d || 1), power * (1 - d / rad) + 0.4, false);
    }
  }

  /** u's nearest crew mate that's up (else the next one in the crew): where u respawns, who the AI sticks with. */
  function buddy(u: Unit) {
    let best = crew[(u.i + 1) % CN]!, bd = 1e18;
    for (let i = 0; i < CN; i++) {
      const v = crew[i]!;
      if (v === u || !v.alive) continue;
      const d = (v.x - u.x) * (v.x - u.x) + (v.y - u.y) * (v.y - u.y);
      if (d < bd) (bd = d), (best = v);
    }
    return best;
  }
  // ---------- Spawning: the tank parachutes in, the plane flies in ----------
  function spawn(u: Unit) {
    // Next to the other one if they're up, else low and centre (the enemies come from the top and sides).
    const other = buddy(u), ax = other.alive ? other.x : W / 2 + (u.i % 2 ? 70 : -70) * (1 + (u.i >> 1)), ay = other.alive ? other.y : H * 0.72;
    for (let k = 0; k < 24; k++) {
      const a = R() * TAU, r = 50 + R() * 80;
      F[BX] = Math.max(40, Math.min(W - 40, ax + Math.cos(a) * r));
      F[BY] = Math.max(80, Math.min(H - 50, ay + Math.sin(a) * r));
      F[BR] = 22 * scale;
      if (u.kind === PLANE || !solid()) break;
    }
    u.x = F[BX]!;
    u.y = F[BY]!;
    u.a = u.ta = -Math.PI / 2;
    u.vx = u.vy = 0;
    u.hp = MAXHP[u.kind]!;
    u.alive = true;
    u.drop = u.shield = u.rapid = u.triple = u.recoil = u.think = u.charge = u.heat = u.hot = u.run = u.bite = 0;
    u.cool = 0; // the guns are ready the moment you land: a held click fires at once (the landing shield covers you)
    u.target = u.chargeT = -1;
    u.gx = u.x;
    u.gy = u.y;
  }

  // ---------- Shake: only what lands near you (or hits you) moves the screen ----------
  let buzz = 0;
  function boomQ() {
    const x = FQ[0]!, y = FQ[1]!, power = FQ[2]!;
    fxPush(FX_BLAST);
    if (demo || !you.alive || state !== "play") return;
    const reach = 250 * (scale / 1.4), d = Math.sqrt((x - you.x) * (x - you.x) + (y - you.y) * (y - you.y));
    if (d < reach) G[QUAKE] = Math.min(18, G[QUAKE]! + power * 3.5 * (1 - d / reach) ** 1.5);
  }
  function debris(x: number, y: number, n: number, c: number, sp: number) {
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, v = sp * (0.6 + R() * 0.8);
      ((FQ[0] = 0), (FQ[1] = x), (FQ[2] = y), (FQ[3] = Math.cos(a) * v), (FQ[4] = Math.sin(a) * v), (FQ[5] = (5 + R() * 6) * (scale / 1.4)), (FQ[6] = 0.9), (FQ[7] = k % 3 ? c : 7), (FQ[8] = R() * TAU), (FQ[9] = (R() - 0.5) * 20), fxPush(FX_SPAWN));
    }
  }

  // ---------- Targets: foes (0..MAXF-1) and sites (MAXF + s), one id space for aim and the AI ----------
  /** Target k's position into F[QX], F[QY]; false when it's gone. */
  function where(k: number) {
    if (k < 0) return false;
    if (k < MAXF) {
      const f = foes[k]!;
      if (!f.on) return false;
      F[QX] = f.x;
      F[QY] = f.y;
      return true;
    }
    const s = sites[k - MAXF]!;
    if (!s.on || s.hp <= 0) return false;
    F[QX] = s.x;
    F[QY] = s.y;
    return true;
  }
  /** Is target k in the air (aliens, flies)? */
  const air = (k: number) => k >= 0 && k < MAXF && (foes[k]!.kind === ALIEN || foes[k]!.kind === FLY);
  /** How much u's ride cares about target k (lower = sooner): the plane goes for the air and the
   *  factories, the tank for walls, cores and armour. Auto-aim (you) treats everything the same. */
  function weightF(u: Unit, k: number) {
    const kd = k >= MAXF ? 4 + sites[k - MAXF]!.kind : foes[k]!.kind;
    if (u.human) F[WT] = 1;
    else if (kd === FROG) F[WT] = 0.5;
    else if (u.kind === PLANE) F[WT] = kd === 4 + FACTORY ? 0.55 : kd === 4 + BASE ? 2.4 : kd === ALIEN || kd === FLY ? 0.6 : kd === ETANK ? 1.8 : 0.9;
    else F[WT] = kd === 4 + BASE ? 0.5 : kd === 4 + FACTORY ? 1.3 : kd === ETANK ? 0.55 : kd === BUG ? (foes[k]!.tier >= 3 ? 0.6 : 0.85) : 1.3;
  }
  /** The best target for u within range of (x, y): by distance × weight. -1 when none. */
  function pick(u: Unit, x: number, y: number, range: number) {
    let best = -1, bd = range;
    for (let i = 0; i < MAXF; i++) {
      const f = foes[i]!;
      if (!f.on) continue;
      F[HX] = f.x - x;
      F[HY] = f.y - y;
      hyp();
      weightF(u, i);
      const d = F[HO]! * F[WT]!;
      if (d < bd) (bd = d), (best = i);
    }
    for (let i = 0; i < SITES; i++) {
      const s = sites[i]!;
      if (!s.on || s.hp <= 0) continue;
      F[HX] = s.x - x;
      F[HY] = s.y - y;
      hyp();
      weightF(u, MAXF + i);
      const d = F[HO]! * F[WT]!;
      if (d < bd) (bd = d), (best = MAXF + i);
    }
    return best;
  }

  // ---------- Combat ----------
  function freeShell() {
    for (let i = 0; i < shells.length; i++) if (!shells[i]!.on) return shells[i]!;
    return null;
  }
  /** A shell from (F[SX], F[SY]) at angle `a`, speed `sp`, `life` s. */
  /** A shell from (F[SX], F[SY]) at angle F[SA], speed F[SS], living F[SL] s. */
  function shoot(owner: number, foe: boolean, kind: number) {
    const s = freeShell(), a = F[SA]!, sp = F[SS]!, life = F[SL]!;
    if (!s) return null;
    s.on = true;
    s.rail = kind === K_RAIL;
    s.tgt = -1;
    s.foe = foe;
    s.kind = kind;
    s.x = F[SX]!;
    s.y = F[SY]!;
    s.vx = Math.cos(a) * sp;
    s.vy = Math.sin(a) * sp;
    s.life = life;
    s.owner = owner;
    return s;
  }
  function fire(u: Unit) {
    u.shots++;
    if (u.kind === TANK) {
      const len = 24 * scale, spreads = u.triple > 0 ? 3 : 1;
      for (let k = 0; k < spreads; k++) {
        const a = u.ta + (spreads > 1 ? (k - 1) * 0.2 : 0) + (R() - 0.5) * (u.human ? 0.04 : 0.08);
        F[SX] = u.x + Math.cos(a) * len;
        F[SY] = u.y + Math.sin(a) * len;
        ((F[SA] = a), (F[SS] = 600), (F[SL] = 1), shoot(u.i, false, K_SHELL));
      }
      u.recoil = 6;
      u.flash = 0.08;
      u.cool = u.rapid > 0 ? 0.1 : u.human ? 0.19 : 0.3;
      // The cannon is quick; hold it down too long and it overheats (rapid fire never does).
      if (u.human && u.rapid <= 0 && (u.heat += 0.16) >= 1) (u.hot = 1.4), ((FQ[0] = u.x), (FQ[1] = u.y - 34), (FQ[2] = W_HOT), (FQ[3] = 2), (FQ[4] = 16), fxPush(FX_WORD));
      ((FQ[0] = 1), (FQ[1] = u.x + Math.cos(u.ta) * len), (FQ[2] = u.y + Math.sin(u.ta) * len), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 9), (FQ[6] = 0.12), (FQ[7] = 0), fxPush(FX_SPAWN));
      e.events.emit("shot", u.i);
      return;
    }
    // The plane: Null Invaders' weapon tiers, guns either side of the nose, no overheating.
    const n = u.tier + (u.triple > 0 ? 2 : 0), ca = Math.cos(u.ta), sa = Math.sin(u.ta);
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 7, fan = u.tier >= 3 ? (k - (n - 1) / 2) * 0.06 : 0;
      F[SX] = u.x + ca * 18 - sa * off;
      F[SY] = u.y + sa * 18 + ca * off;
      ((F[SA] = u.ta + fan + (R() - 0.5) * 0.03), (F[SS] = 780), (F[SL] = 0.72), shoot(u.i, false, K_BOLT));
    }
    u.cool = (u.rapid > 0 ? 0.07 : TIER_COOL[u.tier]!) * (u.human ? 1 : 1.7);
    u.flash = 0.05;
    e.events.emit("bolt", u.i);
  }
  /** LONG (tank): lock on, then a guided round crosses the field. SALVO (plane): four homing rockets. */
  function charge(u: Unit, target: number) {
    if (u.rail <= 0 || u.charge > 0 || !where(target) || !u.alive || u.drop < 1) return;
    u.charge = u.kind === TANK ? 0.45 : 0.2;
    u.chargeT = target;
    if (u.you) ((FQ[0] = F[QX]!), (FQ[1] = F[QY]! - 34), (FQ[2] = W_LOCK), (FQ[3] = 4), (FQ[4] = 14), fxPush(FX_WORD));
    e.events.emit("lock", u.i);
  }
  function fireRail(u: Unit) {
    u.charge = 0;
    if (!where(u.chargeT)) return;
    u.rail--;
    const a = Math.atan2(F[QY]! - u.y, F[QX]! - u.x);
    u.ta = a;
    if (u.kind === TANK) {
      F[SX] = u.x + Math.cos(a) * 26 * scale;
      F[SY] = u.y + Math.sin(a) * 26 * scale;
      const s = ((F[SA] = a), (F[SS] = 1500), (F[SL] = 2), shoot(u.i, false, K_RAIL));
      if (s) s.tgt = u.chargeT;
      u.recoil = 11;
      u.flash = 0.14;
      ((FQ[0] = 1), (FQ[1] = F[SX]!), (FQ[2] = F[SY]!), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 16), (FQ[6] = 0.16), (FQ[7] = 1), fxPush(FX_SPAWN));
      ((FQ[0] = 2), (FQ[1] = F[SX]!), (FQ[2] = F[SY]!), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 8), (FQ[6] = 0.3), (FQ[7] = 1), fxPush(FX_SPAWN));
    } else {
      // Four rockets fan out from the wings, then each homes in on its own target.
      for (let k = 0; k < 4; k++) {
        const side = k % 2 ? 1 : -1;
        F[SX] = u.x - Math.sin(a) * side * 14;
        F[SY] = u.y + Math.cos(a) * side * 14;
        const s = ((F[SA] = a + side * (0.5 + k * 0.15)), (F[SS] = 620), (F[SL] = 2.2), shoot(u.i, false, K_RAIL));
        if (s) s.tgt = k === 0 ? u.chargeT : pick(u, F[QX]! + (R() - 0.5) * 200, F[QY]! + (R() - 0.5) * 200, 500);
        if (s && s.tgt < 0) s.tgt = u.chargeT;
      }
      ((FQ[0] = 2), (FQ[1] = u.x), (FQ[2] = u.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 12), (FQ[6] = 0.3), (FQ[7] = 4), fxPush(FX_SPAWN));
    }
    if (u.you) G[QUAKE] = Math.min(18, G[QUAKE]! + 3);
    e.events.emit("shot", u.i, 0, 0, 0, 1.5);
  }
  function score(n: number) {
    if (!demo) G[SCORE]! += n;
  }
  /** Unit u (one of yours) is hit. */
  function damage(u: Unit, amount: number) {
    if (!u.alive || u.drop < 1 || state !== "play") return false;
    if (u.shield > 0) return ((FQ[0] = 2), (FQ[1] = u.x), (FQ[2] = u.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 18), (FQ[6] = 0.3), (FQ[7] = 4), fxPush(FX_SPAWN)), false;
    u.hp -= amount;
    u.flash = 0.12;
    if (u.you) (G[QUAKE] = Math.min(18, G[QUAKE]! + amount * 2.5)), (buzz += 35 * amount);
    e.events.emit("hit", u.i);
    if (u.hp <= 0) wreck(u);
    return true;
  }
  function wreck(u: Unit) {
    u.alive = false;
    u.deaths++;
    u.run = 0;
    u.charge = 0;
    if (u.you) targeting = false;
    // The AI partner always comes back; people come back while there are DROPS (board), always elsewhere.
    u.dead = u.human ? 2.4 : 3.5;
    if (u.human && !embed && !demo) {
      if (G[DROPS]! <= 0) G[OUT_T] = 1.6;
      else G[DROPS]!--;
    }
    ((FQ[0] = u.x), (FQ[1] = u.y), (FQ[2] = 2.2), (FQ[3] = 3), boomQ());
    ((FQ[0] = u.x + (R() - 0.5) * 30), (FQ[1] = u.y + (R() - 0.5) * 30), (FQ[2] = 1.2), (FQ[3] = 1), boomQ());
    debris(u.x, u.y, 9, 5, 160);
    ((FQ[0] = u.x), (FQ[1] = u.y - 18), (FQ[2] = (R() * 5) | 0), (FQ[3] = 3), (FQ[4] = 18), fxPush(FX_WORD));
    if (u.you) (G[QUAKE] = 16), (buzz += 220);
    e.events.emit("boom", u.i);
    feedK[feedN % 8] = -1 - u.i;
    feedV[feedN % 8] = 0;
    feedN++;
  }
  /** A kill streak pays out (Blitz): 3 a long shot (or salvo), 5 an airstrike, 8 a carpet bomb. */
  function reward(u: Unit) {
    const r = u.run;
    if (r === 3) u.rail = Math.min(RAIL_MAX, u.rail + 1);
    else if (r === 5) u.strikes = Math.min(STRIKE_MAX, u.strikes + 1);
    else if (r === 8) (u.strikes = Math.min(STRIKE_MAX, u.strikes + 1)), u.carpet++;
    else return;
    if (u.you) (bannerKind = 0), (bannerV = r), bannerN++, e.events.emit("streak", u.i);
  }
  /** Credit a kill to unit `by` (-1: nobody: a mine, a fly eaten by power). */
  function credit(by: number, pts: number, xp: number, x: number, y: number) {
    score(pts);
    if (!demo) G[KILLS]!++;
    if (by < 0) return;
    const u = crew[by]!;
    u.kills++;
    u.run++;
    reward(u);
    if (u.kind === PLANE) {
      u.xp += xp;
      if (u.tier < 4 && u.xp >= TIER_XP[u.tier + 1]!) {
        u.tier++;
        ((FQ[0] = u.x), (FQ[1] = u.y - 40), (FQ[2] = W_TIER + u.tier), (FQ[3] = 4), (FQ[4] = 20), fxPush(FX_WORD));
        if (u.you) (bannerKind = 1), (bannerV = u.tier), bannerN++;
        e.events.emit("streak", u.i);
      }
    }
  }
  /** Foe f takes F[AMT] from unit `by` (its ride's multiplier already applied). */
  function hurtFoe(f: Foe, by: number) {
    const amount = F[AMT]!;
    if (!f.on) return;
    f.hp -= amount;
    f.flash = 0.1;
    if (f.hp > 0) return;
    f.on = false;
    if (f.food >= 0 && gres[f.food] === foes.indexOf(f)) gres[f.food] = -1;
    const k = f.kind;
    if (f.boss) ((FQ[0] = f.x), (FQ[1] = f.y - 40), (FQ[2] = W_BOSS), (FQ[3] = 3), (FQ[4] = 24), fxPush(FX_WORD)), (G[QUAKE] = Math.min(18, G[QUAKE]! + 8));
    if (k === ETANK || k === FROG || f.boss) {
      ((FQ[0] = f.x), (FQ[1] = f.y), (FQ[2] = f.boss ? 3 : 2), (FQ[3] = 3), boomQ());
      debris(f.x, f.y, 8, 2, 150);
      ((FQ[0] = f.x), (FQ[1] = f.y - 18), (FQ[2] = (R() * 5) | 0), (FQ[3] = 3), (FQ[4] = 18), fxPush(FX_WORD));
      e.events.emit("boom", -1);
    } else {
      ((FQ[0] = f.x), (FQ[1] = f.y), (FQ[2] = k === BUG ? 0.7 : 1), (FQ[3] = k === FLY ? 8 : k === BUG ? 9 : 4), boomQ());
      debris(f.x, f.y, 5, k === FLY ? 8 : k === ALIEN ? 4 : 9, 120);
      e.events.emit("hit", -1);
    }
    credit(by, (k === BUG ? 10 * f.tier : k === ALIEN ? 20 + 10 * f.sub : k === ETANK ? 60 : k === FROG ? 200 + 50 * f.tier : 30 + 15 * f.tier) * (f.boss ? 4 : 1), k === ALIEN ? 4 : k === FLY ? 3 : k === FROG ? 8 : k === ETANK ? 2 : 1, f.x, f.y);
    if (by >= 0) (feedK[feedN % 8] = by), (feedV[feedN % 8] = k), feedN++;
  }
  /** Site s takes damage. A factory breaks (no more aliens); a base's core falls and the base is yours. */
  function hurtSite(s: Site, by: number) {
    const amount = F[AMT]!;
    if (!s.on || s.hp <= 0) return;
    s.hp -= amount;
    s.flash = 0.1;
    if (s.hp > 0) return;
    ((FQ[0] = s.x), (FQ[1] = s.y), (FQ[2] = 3), (FQ[3] = 3), boomQ());
    ((FQ[0] = s.x + 20), (FQ[1] = s.y - 10), (FQ[2] = 1.8), (FQ[3] = 1), (FQ[4] = 0.15), laterQ());
    ((FQ[0] = s.x - 24), (FQ[1] = s.y + 8), (FQ[2] = 1.5), (FQ[3] = 4), (FQ[4] = 0.3), laterQ());
    debris(s.x, s.y, 14, s.kind === FACTORY ? 4 : 1, 220);
    if (s.kind === BASE) (s.won = true), (s.hp = 0), ((FQ[0] = s.x), (FQ[1] = s.y - 40), (FQ[2] = W_TAKEN), (FQ[3] = 5), (FQ[4] = 24), fxPush(FX_WORD));
    else ((FQ[0] = s.x), (FQ[1] = s.y - 40), (FQ[2] = W_FACTORY), (FQ[3] = 4), (FQ[4] = 24), fxPush(FX_WORD));
    credit(by, s.kind === BASE ? 400 : 250, 8, s.x, s.y);
    if (by >= 0) (feedK[feedN % 8] = by), (feedV[feedN % 8] = s.kind === BASE ? 6 : 5), feedN++;
    if (!demo) G[QUAKE] = Math.min(18, G[QUAKE]! + 6);
    e.events.emit("boom", -1, 0, 0, 0, 1.4);
  }
  /** Hit target k (a foe or a site) with a shot of `kind` from unit `by`. */
  function hitTarget(k: number, by: number, kind: number) {
    const ridek = crew[by]!.kind, row = HURT[ridek]!;
    if (k < MAXF) {
      const f = foes[k]!, col = f.kind === BUG || f.kind === FROG ? 0 : f.kind === ALIEN ? 1 : f.kind === ETANK ? 2 : 3;
      ((F[AMT] = kind === K_RAIL ? (ridek === TANK ? 6 : 3) : row[col]!), hurtFoe(f, by));
    } else {
      const s = sites[k - MAXF]!;
      ((F[AMT] = kind === K_RAIL ? (ridek === TANK ? 5 : 1.5) : row[s.kind === FACTORY ? H_FACTORY : H_CORE]!), hurtSite(s, by));
    }
  }

  // ---------- Airstrikes (Blitz): a bomber crosses the field and the bombs walk over the target ----------
  function callStrike(owner: number) {
    const x = F[KX]!, y = F[KY]!, u = crew[owner]!;
    if (u.strikes <= 0 || !u.alive || u.drop < 1) return false;
    let m: Mark | null = null, p: Bomber | null = null;
    for (let i = 0; i < marks.length; i++) if (!marks[i]!.on) m = marks[i]!;
    for (let i = 0; i < bombers.length; i++) if (!bombers[i]!.on) p = bombers[i]!;
    if (!m || !p) return false;
    u.strikes--;
    const carpet = u.carpet > 0;
    if (carpet) u.carpet--;
    F[HX] = x - u.x;
    F[HY] = y - u.y;
    hyp();
    const a = F[HO]! > 40 ? Math.atan2(y - u.y, x - u.x) : R() * TAU;
    F[HX] = W;
    F[HY] = H;
    hyp();
    const ca = Math.cos(a), sa = Math.sin(a), speed = 820, reach = F[HO]! * 0.65;
    p.on = true;
    p.owner = owner;
    p.a = a;
    p.x = x - ca * reach;
    p.y = y - sa * reach;
    p.vx = ca * speed;
    p.vy = sa * speed;
    p.t = (reach * 2) / speed;
    const n = carpet ? 7 : 3, gap = (carpet ? 56 : 42) * (scale / 1.4);
    F[LAST] = 0;
    for (let k = 0; k < n; k++) {
      let b: Bomb | null = null;
      for (let i = 0; i < bombs.length; i++) if (!bombs[i]!.on) b = bombs[i]!;
      if (!b) break;
      const off = (k - (n - 1) / 2) * gap, side = (R() - 0.5) * 26;
      b.on = true;
      b.owner = owner;
      b.main = carpet || k === (n - 1) / 2;
      b.x = x + ca * off - sa * side;
      b.y = y + sa * off + ca * side;
      b.wait = (reach + off) / speed;
      b.fall = 0.5;
      F[LAST] = Math.max(F[LAST]!, b.wait + b.fall);
    }
    m.on = true;
    m.owner = owner;
    m.x = x;
    m.y = y;
    m.t = m.max = F[LAST]! + 0.1;
    if (carpet) ((FQ[0] = x), (FQ[1] = y - 70), (FQ[2] = W_CARPET), (FQ[3] = 3), (FQ[4] = 22), fxPush(FX_WORD));
    e.events.emit("strike", owner);
    return true;
  }
  function laterQ() {
    for (let i = 0; i < booms.length; i++) {
      const b = booms[i]!;
      if (!b.on) {
        b.on = true;
        b.x = FQ[0]!;
        b.y = FQ[1]!;
        b.p = FQ[2]!;
        b.c = FQ[3]!;
        b.t = FQ[4]!;
        FQ.fill(0);
        return;
      }
    }
    FQ.fill(0);
  }
  function detonate(b: Bomb) {
    const p = b.main ? 3.2 : 2.4;
    ((FQ[0] = b.x), (FQ[1] = b.y), (FQ[2] = p), (FQ[3] = 3), boomQ());
    ((FQ[0] = b.x + (R() - 0.5) * 60), (FQ[1] = b.y + (R() - 0.5) * 48), (FQ[2] = 1.6), (FQ[3] = 1), (FQ[4] = 0.09), laterQ());
    ((FQ[0] = b.x + (R() - 0.5) * 60), (FQ[1] = b.y + (R() - 0.5) * 48), (FQ[2] = 1.3), (FQ[3] = 4), (FQ[4] = 0.19), laterQ());
    if (b.main && R() < 0.6) ((FQ[0] = b.x), (FQ[1] = b.y - 30), (FQ[2] = W_STRIKE), (FQ[3] = 3), (FQ[4] = 22), fxPush(FX_WORD));
    const rad = (b.main ? 95 : 80) * (scale / 1.4);
    for (let i = 0; i < MAXF; i++) {
      const f = foes[i]!;
      if (!f.on) continue;
      F[HX] = f.x - b.x;
      F[HY] = f.y - b.y;
      hyp();
      if (F[HO]! < rad) ((F[AMT] = F[HO]! < rad * 0.6 ? 6 : 3), hurtFoe(f, b.owner));
    }
    for (let i = 0; i < SITES; i++) {
      const s = sites[i]!;
      if (s.on && s.hp > 0 && ((F[HX] = s.x - b.x), (F[HY] = s.y - b.y), hyp(), F[HO]! < rad + s.w / 2)) ((F[AMT] = 3), hurtSite(s, b.owner));
    }
    for (let i = 0; i < blocks.length; i++) {
      const k = blocks[i]!;
      if (k.hp > 0 && ((F[HX] = k.x + k.w / 2 - b.x), (F[HY] = k.y + k.h / 2 - b.y), hyp(), F[HO]! < rad + 20)) wreckBlock(k);
    }
    if (embed) knockAround(b.x, b.y, rad * 2, 2.4);
    e.events.emit("boom", -1, 0, 0, 0, 1.4);
  }
  function wreckBlock(b: Block) {
    if (b.site >= 0 && b.hp > 0) ((FQ[0] = b.x + b.w / 2), (FQ[1] = b.y - 8), (FQ[2] = W_BREACH), (FQ[3] = 3), (FQ[4] = 18), fxPush(FX_WORD));
    b.hp = 0;
    b.back = 12;
    debris(b.x + b.w / 2, b.y + b.h / 2, 8, b.site >= 0 ? 1 : 6, 140);
  }
  /** Shell from unit `by` hits block b. */
  function hitBlock(b: Block, by: number, rail: boolean) {
    if (rail) return wreckBlock(b);
    const amt = b.site >= 0 ? HURT[crew[by]!.kind]![H_WALL]! : 1;
    if ((b.hp -= amt) <= 0) wreckBlock(b);
  }

  // ---------- Power tiles (the blinking grid) and supply crates (Blitz) ----------
  function lightTile(show = false) {
    let s: Tile | null = null, n = 0;
    for (let i = 0; i < tiles.length; i++) tiles[i]!.on ? n++ : (s = tiles[i]!);
    if (!s || cols < 3 || rows < 3 || (!show && n >= 6)) return;
    s.on = true;
    s.c = 1 + Math.floor(R() * (cols - 2));
    s.r = 2 + Math.floor(R() * (rows - 3));
    const roll = R();
    s.type = roll < 0.16 ? RAPID : roll < 0.3 ? TRIPLE : roll < 0.42 ? STRIKE : roll < 0.54 ? SHIELD : roll < 0.76 ? HEAL : roll < 0.9 ? AMMO : MINE;
    s.roll = show ? 0.5 + R() * 0.5 : 1.1;
    s.t = show ? 1.2 + R() * 1.4 : 8;
  }
  function takeTile(s: Tile, u: Unit | null) {
    s.on = false;
    const cx = (s.c + 0.5) * T, cy = (s.r + 0.5) * T;
    if (s.type === MINE) {
      ((FQ[0] = cx), (FQ[1] = cy), (FQ[2] = 2.6), (FQ[3] = 3), boomQ());
      ((FQ[0] = cx), (FQ[1] = cy - 26), (FQ[2] = W_MINE), (FQ[3] = 3), (FQ[4] = 20), fxPush(FX_WORD));
      // A mine hurts everything on the ground nearby: your tank, bugs, enemy tanks.
      for (let i = 0; i < CN; i++) {
        const v = crew[i]!;
        if (v.kind === TANK && Math.sqrt((v.x - cx) * (v.x - cx) + (v.y - cy) * (v.y - cy)) < 80 * (scale / 1.4)) damage(v, 2);
      }
      for (let i = 0; i < MAXF; i++) {
        const f = foes[i]!;
        if (f.on && (f.kind === BUG || f.kind === ETANK) && Math.sqrt((f.x - cx) * (f.x - cx) + (f.y - cy) * (f.y - cy)) < 80 * (scale / 1.4)) ((F[AMT] = 4), hurtFoe(f, -1));
      }
      e.events.emit("boom", -1);
      return;
    }
    if (!u) return;
    if (s.type === RAPID) (u.rapid = 8), (u.hot = 0), (u.heat = 0);
    if (s.type === TRIPLE) u.triple = 8;
    if (s.type === SHIELD) u.shield = 6;
    if (s.type === STRIKE) u.strikes = Math.min(STRIKE_MAX, u.strikes + 1);
    if (s.type === HEAL) u.hp = Math.min(MAXHP[u.kind]!, u.hp + 2);
    if (s.type === AMMO) u.rail = Math.min(RAIL_MAX, u.rail + 1);
    ((FQ[0] = 2), (FQ[1] = cx), (FQ[2] = cy), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 20), (FQ[6] = 0.5), (FQ[7] = s.type === STRIKE ? 3 : s.type === AMMO ? 1 : 5), fxPush(FX_SPAWN));
    ((FQ[0] = cx), (FQ[1] = cy - 22), (FQ[2] = TILE_WORD[s.type]!), (FQ[3] = s.type === STRIKE ? 3 : s.type === AMMO ? 1 : 5), (FQ[4] = 15), fxPush(FX_WORD));
    e.events.emit("power", u.i);
  }
  function dropCrate() {
    if (supply.count === 2) return;
    let x = 0, y = 0;
    for (let k = 0; k < 24; k++) {
      x = 40 + R() * (W - 80);
      y = 90 + R() * (H - 150);
      F[BX] = x;
      F[BY] = y;
      F[BR] = 24 * scale;
      if (!solid()) break;
    }
    const r = R(), kind = r < 0.38 ? 0 : r < 0.66 ? 1 : r < 0.9 ? 2 : 3;
    supply.spawn(x, y, kind);
    ((FQ[0] = x), (FQ[1] = y - 130), (FQ[2] = W_SUPPLY), (FQ[3] = 1), (FQ[4] = 18), fxPush(FX_WORD));
    feedK[feedN % 8] = -9;
    feedV[feedN % 8] = kind;
    feedN++;
    e.events.emit("ready", -1);
  }
  function takeCrate(i: number, u: Unit) {
    const x = supply.x[i]!, y = supply.y[i]!, kind = supply.kind[i]!;
    supply.collect(x, y, 0.5);
    if (kind === 0 || kind === 3) (u.hp = MAXHP[u.kind]!), (u.shield = Math.max(u.shield, 2));
    if (kind === 1) u.rail = Math.min(RAIL_MAX, u.rail + 2);
    if (kind === 2 || kind === 3) u.strikes = Math.min(STRIKE_MAX, u.strikes + 1);
    if (kind === 3) u.rail = Math.min(RAIL_MAX, u.rail + 1);
    ((FQ[0] = 2), (FQ[1] = x), (FQ[2] = y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 26), (FQ[6] = 0.6), (FQ[7] = 1), fxPush(FX_SPAWN));
    debris(x, y, 8, 1, 120);
    ((FQ[0] = x), (FQ[1] = y - 26), (FQ[2] = CRATE_WORD[kind]!), (FQ[3] = 1), (FQ[4] = 18), fxPush(FX_WORD));
    e.events.emit("power", u.i);
  }

  // ---------- The waves ----------
  /** The wave's place: its section (0-3 the armies, 4 the finale), its step in the section (0-3),
   *  and how many times the whole run has looped (the drop-in and the attract match go on). */
  const wave = () => (demo ? FINALE : ((Math.max(1, G[WAVE]!) - 1) % FINALE) + 1);
  const section = () => (wave() >= FINALE ? 4 : (wave() - 1) >> 2);
  const step = () => (wave() >= FINALE ? 3 : (wave() - 1) & 3);
  const loops = () => Math.floor((Math.max(1, G[WAVE]!) - 1) / FINALE);
  /** n foes for this board (a bigger board gets more), a loop more again. */
  const sized = (n: number) => Math.max(2, Math.round(n * area * (1 + loops() * 0.35)));
  /** A free spot for a w × h site: off cover, off other sites, away from your rides (F[AX], F[AY]). */
  function siteSpot(w: number, h: number, top: boolean) {
    for (let k = 0; k < 40; k++) {
      F[AX] = w / 2 + 30 + R() * (W - w - 60);
      F[AY] = top ? 110 + R() * Math.max(10, H * 0.42 - 110) : 110 + R() * Math.max(10, H * 0.6 - 110);
      let ok = true;
      for (let i = 0; i < SITES && ok; i++) {
        const s = sites[i]!;
        if (s.on && Math.abs(s.x - F[AX]!) < (s.w + w) / 2 + 60 && Math.abs(s.y - F[AY]!) < (s.h + h) / 2 + 60) ok = false;
      }
      for (let i = 0; i < CN && ok; i++) if (crew[i]!.alive && Math.sqrt((crew[i]!.x - F[AX]!) * (crew[i]!.x - F[AX]!) + (crew[i]!.y - F[AY]!) * (crew[i]!.y - F[AY]!)) < 220) ok = false;
      if (ok) return;
    }
  }
  /** Clear cover under a site's footprint (it grows back after the wave). */
  function clearUnder(x: number, y: number, w: number, h: number) {
    for (let i = 0; i < coverN; i++) {
      const b = blocks[i]!;
      if (b.hp > 0 && b.x < x + w / 2 + 10 && b.x + b.w > x - w / 2 - 10 && b.y < y + h / 2 + 10 && b.y + b.h > y - h / 2 - 10) (b.hp = 0), (b.back = 30);
    }
  }
  function addSite(kind: number) {
    let s: Site | null = null, idx = 0;
    for (let i = 0; i < SITES; i++) if (!sites[i]!.on) (s = sites[i]!), (idx = i), (i = SITES);
    if (!s) return;
    const w = kind === FACTORY ? T * 2.6 : T * 1.8, h = kind === FACTORY ? T * 0.95 : T * 0.95, fort = kind === BASE ? T * 1.3 : 20;
    siteSpot(w + fort * 2, h + fort * 2, kind === FACTORY);
    s.on = true;
    s.kind = kind;
    s.x = F[AX]!;
    s.y = F[AY]!;
    s.w = w;
    s.h = h;
    s.max = s.hp = (kind === FACTORY ? 50 + 12 * step() : 28 + 6 * step()) * (1 + loops() * 0.5);
    s.t = 1 + R() * 1.5;
    s.cool = 1.5;
    s.label = (G[WAVE]! * 3 + idx) % LABELS.length;
    s.won = false;
    s.out = 0;
    clearUnder(s.x, s.y, w + fort * 2, h + fort * 2);
    if (kind === BASE) {
      // Sherman Bytes: four wall segments around the button, a gap at each corner.
      let wi = 0;
      for (let i = coverN; i < blocks.length && wi < 4; i++) {
        const b = blocks[i]!;
        if (b.hp > 0) continue;
        const g = T * 0.42, ox = w / 2 + fort * 0.55, oy = h / 2 + fort * 0.55;
        if (wi < 2) (b.w = w + fort * 0.6), (b.h = g), (b.x = s.x - b.w / 2), (b.y = s.y + (wi ? oy : -oy) - g / 2);
        else (b.w = g), (b.h = h + fort * 0.4), (b.x = s.x + (wi === 3 ? ox : -ox) - g / 2), (b.y = s.y - b.h / 2);
        b.hp = 4;
        b.site = idx;
        wi++;
      }
    }
  }
  /** Put pellet p on a block that has none (Byte Runner: the food sits on the board's blocks), or on
   *  open ground when there are no blocks (the drop-in's page). */
  function placePellet(p: number) {
    for (let k = 0; k < 16; k++) {
      let x = 0, y = 0;
      if (coverN && k < 12) {
        const b = blocks[Math.floor(R() * coverN)]!;
        if (b.hp <= 0) continue;
        (x = b.x + b.w / 2), (y = b.y + b.h / 2);
      } else (x = 60 + R() * (W - 120)), (y = 100 + R() * (H - 160));
      let taken = false;
      for (let q = 0; q < pellets && !taken; q++) if (q !== p && pelOn[q] && Math.abs(pelX[q]! - x) < 8 && Math.abs(pelY[q]! - y) < 8) taken = true;
      if (taken) continue;
      pelX[p] = x;
      pelY[p] = y;
      pelOn[p] = 1;
      return;
    }
  }
  /** Pellet p is eaten: it comes back on another block a few seconds later. */
  function eatPellet(p: number) {
    pelOn[p] = 0;
    pelBack[p] = 5 + R() * 4;
    ((FQ[0] = 2), (FQ[1] = pelX[p]!), (FQ[2] = pelY[p]!), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 14), (FQ[6] = 0.35), (FQ[7] = 8), fxPush(FX_SPAWN));
    e.events.emit("chomp", -1);
  }
  /** The nearest pellet to foe f within `range`, into F[QX], F[QY]; its index or -1. */
  function nearestPellet(f: Foe, range: number) {
    let best = -1, bd = range * range;
    for (let p = 0; p < pellets; p++) {
      if (!pelOn[p]) continue;
      const dx = pelX[p]! - f.x, dy = pelY[p]! - f.y, d = dx * dx + dy * dy;
      if (d < bd) (bd = d), (best = p);
    }
    if (best >= 0) (F[QX] = pelX[best]!), (F[QY] = pelY[best]!);
    return best;
  }
  function startWave() {
    G[PHASE] = P_CARD;
    G[PH_T] = demo ? 1.2 : 2.8;
    G[WAVE_T] = 0;
    for (let is1 = 0; is1 < sites.length; is1++) { const s = sites[is1]!; s.on = false; }
    for (let i = coverN; i < blocks.length; i++) (blocks[i]!.hp = 0), (blocks[i]!.site = -2);
    // The letters come back each wave (the page heals between cartridges).
    for (let g = 0; g < glyphs; g++) (gate[g] = 0), (gres[g] = -1);
    // Each section escalates: more foes, faster (LVL), tougher, a mini-boss on its fourth wave.
    const sec = section(), k = step(), fin = sec === 4;
    G[LVL] = k + loops() * 2;
    G[BUGS_LEFT] = sec === 0 ? sized(12 + 6 * k) : fin ? sized(12) : 0;
    const factories = sec === 1 ? 2 + (k >= 2 ? 1 : 0) : fin ? 1 : 0, bases = sec === 2 ? (k ? 2 : 1) : fin ? 1 : 0;
    for (let n = Math.min(factories, Math.max(1, Math.round(factories * Math.min(1, area + 0.15)))); n > 0; n--) addSite(FACTORY);
    for (let n = Math.min(bases, area < 0.8 ? 1 : 2); n > 0; n--) addSite(BASE);
    G[FLIES_LEFT] = sec === 3 ? sized(5 + 3 * k) : fin ? sized(6) : 0;
    G[FROGS_LEFT] = sec === 3 || fin ? 1 : 0;
    pellets = sec === 3 || fin ? Math.min(PCAP, Math.round((8 + 2 * k) * Math.min(1.2, area + 0.2))) : 0;
    for (let p = 0; p < pellets; p++) (pelOn[p] = 0), placePellet(p);
    G[BUG_IN] = 0.4;
    G[FLY_IN] = 0.6;
    waveN++;
    e.events.emit("wave", G[WAVE]!);
  }
  /** The fight starts: the section's mini-boss on its fourth wave, Byte Runner's frog. */
  function fightStarts() {
    const sec = section(), k = step(), boss = k === 3 && sec < 4;
    if (G[FROGS_LEFT]! > 0) frogIn(boss ? 6 : sec === 4 ? 2 : k), G[FROGS_LEFT]!--;
    if (!boss) return;
    let i = -1;
    if (sec === 0) i = addFoe(BUG, W / 2, 40, 0, -1);
    else if (sec === 1) i = addFoe(ALIEN, W / 2, 70, 2, -1);
    else if (sec === 2) i = addFoe(ETANK, W / 2, 80, 0, -1);
    if (i < 0) return;
    const f = foes[i]!;
    f.boss = 1;
    if (sec === 0) (f.tier = 3), (f.eaten = 12);
    f.max = f.hp = (sec === 0 ? 10 : sec === 1 ? 16 : 14) * (1 + loops() * 0.5);
    e.events.emit("streak", -1);
  }
  function freeFoe() {
    for (let i = 0; i < MAXF; i++) if (!foes[i]!.on) return i;
    return -1;
  }
  function addFoe(kind: number, x: number, y: number, sub: number, home: number) {
    const i = freeFoe();
    if (i < 0) return -1;
    const f = foes[i]!;
    f.on = true;
    f.kind = kind;
    f.sub = sub;
    f.x = x;
    f.y = y;
    f.vx = f.vy = 0;
    f.a = f.ta = Math.PI / 2;
    f.tier = 1;
    f.eaten = 0;
    f.home = home;
    f.mode = 0;
    f.cool = 1 + R() * 1.5;
    f.think = 0;
    f.t = 0;
    f.flash = 0;
    f.food = -1;
    f.u = 0;
    f.boss = 0;
    f.recoil = 0;
    f.max = f.hp = kind === BUG ? 1 : kind === ALIEN ? 1 + sub : kind === ETANK ? 3 : kind === FROG ? 8 : 1;
    f.gx = x;
    f.gy = y;
    return i;
  }
  /** A bug comes in from an edge (Swarm Protocol: they arrive in threes). */
  function bugIn() {
    const side = (R() * 4) | 0, along = R();
    const x = side === 0 ? along * W : side === 1 ? W + 10 : side === 2 ? along * W : -10;
    const y = side === 0 ? 50 : side === 1 ? 60 + along * (H - 80) : H + 10, yy = side === 3 ? 60 + along * (H - 80) : y;
    for (let k = 0; k < 4 && G[BUGS_LEFT]! > 0; k++, G[BUGS_LEFT]!--) {
      const i = addFoe(BUG, x + (R() - 0.5) * 40, yy + (R() - 0.5) * 40, 0, -1);
      // Later in the section some arrive already grown (six letters in).
      if (i >= 0 && step() >= 2 && R() < 0.35) (foes[i]!.tier = 2), (foes[i]!.eaten = 6), (foes[i]!.hp = foes[i]!.max = 2);
    }
  }
  /** A fly comes in from an edge. */
  function flyIn() {
    const side = (R() * 4) | 0, along = R();
    const x = side === 1 ? W + 10 : side === 3 ? -10 : along * W, y = side === 0 ? 50 : side === 2 ? H + 10 : 60 + along * (H - 80);
    if (addFoe(FLY, x, y, (G[FLIES_LEFT]! | 0) % 3, -1) >= 0) G[FLIES_LEFT]!--;
  }
  /** Byte Runner's frog hops in from the side, already `ate` pellets fat (the mini-boss: big enough to eat you). */
  function frogIn(ate: number) {
    const left = R() < 0.5, i = addFoe(FROG, left ? -10 : W + 10, H * (0.35 + R() * 0.4), 0, -1);
    if (i < 0) return;
    const f = foes[i]!;
    for (let k = 0; k < ate; k++) frogGrows(f);
    f.boss = ate >= 6 ? 1 : 0;
  }
  /** A frog ate a pellet: bigger, tougher, and at four pellets big enough to eat a ride. */
  function frogGrows(f: Foe) {
    f.eaten++;
    f.tier = Math.min(6, 1 + (f.eaten >> 1));
    f.max += 2;
    f.hp += 2;
  }
  /** Is the wave beaten? No foes, no standing factory or core, nothing left to come. */
  function cleared() {
    if (G[BUGS_LEFT]! > 0 || G[FLIES_LEFT]! > 0 || G[FROGS_LEFT]! > 0) return false;
    for (let i = 0; i < MAXF; i++) if (foes[i]!.on) return false;
    for (let i = 0; i < SITES; i++) if (sites[i]!.on && sites[i]!.hp > 0) return false;
    return true;
  }

  // ---------- Steering ----------
  function turnF() {
    const from = F[TF]!, to = F[TT]!, max = F[TM]!, d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    F[TO] = from + Math.sign(d) * Math.min(Math.abs(d), max);
  }
  /** Drive a tank (yours, or an enemy's when `foe`) by the stick (F[DX], F[DY]) for F[DT] s at `speed`. */
  function driveF(out: Float64Array) {
    const ax = F[DX]!, ay = F[DY]!, dt = F[DT]!, x = out[0]!, y = out[1]!, speed = F[SPD]!;
    let a = out[2]!;
    F[HX] = ax;
    F[HY] = ay;
    hyp();
    const m = Math.min(1, F[HO]!);
    out[3] = 0;
    if (m < 0.05) return;
    F[TF] = a;
    F[TT] = Math.atan2(ay, ax);
    F[TM] = 7 * dt;
    turnF();
    a = out[2] = F[TO]!;
    const sp = speed * m * (scale / 1.4) * dt, nx = x + Math.cos(a) * sp, ny = y + Math.sin(a) * sp, rad = 14 * scale;
    F[BX] = nx;
    F[BY] = y;
    F[BR] = rad;
    if (!solid()) out[0] = nx;
    F[BX] = out[0]!;
    F[BY] = ny;
    F[BR] = rad;
    if (!solid()) out[1] = ny;
    out[3] = sp;
  }
  const dv = new Float64Array(4);
  function drive(u: Unit) {
    if (u.kind === PLANE) return fly(u);
    (dv[0] = u.x), (dv[1] = u.y), (dv[2] = u.a), (F[SPD] = 150), driveF(dv);
    u.x = dv[0]!;
    u.y = dv[1]!;
    u.a = dv[2]!;
    u.tread += dv[3]! * 0.15;
  }
  /** The plane: thrust toward the stick, a little drift, flies over cover. */
  function fly(u: Unit) {
    const ax = F[DX]!, ay = F[DY]!, dt = F[DT]!, sp = 290 * (scale / 1.4);
    u.vx += (ax * sp - u.vx) * Math.min(1, dt * 5);
    u.vy += (ay * sp - u.vy) * Math.min(1, dt * 5);
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    u.tread += dt * 8;
    if (ax * ax + ay * ay > 0.01) (F[TF] = u.a), (F[TT] = Math.atan2(ay, ax)), (F[TM] = 6 * dt), turnF(), (u.a = F[TO]!);
  }
  /** Turn a turret (u.ta) toward F[TT] by at most F[TM]. */
  function turretF(u: { ta: number }) {
    F[TF] = u.ta;
    turnF();
    u.ta = F[TO]!;
  }

  // ---------- Your controls, and the seam ----------
  /** What your guns are on: the lock, else auto-aim's pick, else nothing (-1). */
  function aimTarget() {
    if (lockOn) {
      if (!where(lockT)) lockT = pick(you, you.x, you.y, 9999);
      if (lockT >= 0) return lockT;
    }
    return autoOn ? pick(you, you.x, you.y, 520) : -1;
  }
  function player() {
    const dt = G[DTS]!;
    const u = you;
    (F[DX] = input.axis("left", "right", 0)), (F[DY] = input.axis("up", "down", 1)), (F[DT] = dt), drive(u);
    const touch = input.stick.active || coarse.matches, aim = aimTarget();
    if (aim >= 0 && where(aim)) (F[TT] = Math.atan2(F[QY]! - u.y, F[QX]! - u.x)), (F[TM] = (u.kind === PLANE ? 12 : 8) * dt), turretF(u);
    else if (!touch || input.pointer.down) (F[TT] = Math.atan2(input.pointer.y - u.y, input.pointer.x - u.x)), (F[TM] = (u.kind === PLANE ? 14 : 10) * dt), turretF(u);
    else (F[TT] = u.a), (F[TM] = 4 * dt), turretF(u);
    if ((input.down("fire") || input.pointer.down || fireQ) && !targeting && u.cool <= 0 && u.hot <= 0 && u.charge <= 0) fire(u);
    if (u.cool <= 0) fireQ = false;
    if (longQ) {
      longQ = false;
      charge(u, aim >= 0 ? aim : touch ? pick(u, u.x, u.y, 9999) : pick(u, input.pointer.x, input.pointer.y, 9999));
    }
    if (strikeT) (strikeT = false), (targeting = !targeting && u.strikes > 0);
    if (strikeQ) {
      strikeQ = false;
      if (((F[KX] = strikeX), (F[KY] = strikeY), callStrike(0))) targeting = false;
    }
    if (u.strikes <= 0) targeting = false;
  }
  /** The partner (and both rides in the attract match): Blitz's bot brain, given a ride's job. */
  function ai(u: Unit) {
    const dt = G[DTS]!;
    if (dodge(u)) return;
    const other = buddy(u);
    u.think -= dt;
    if (u.think <= 0) {
      u.think = 0.4 + R() * 0.5;
      // Stay in reach of the other ride; go after what this ride is good at.
      const cx = other.alive ? other.x * 0.5 + u.x * 0.5 : u.x, cy = other.alive ? other.y * 0.5 + u.y * 0.5 : u.y;
      u.target = pick(u, cx, cy, 900);
      let gxx = -1, gyy = 0;
      // Hurt: a heal tile or a crate first.
      if (u.hp <= MAXHP[u.kind]! / 2)
        for (let is2 = 0; is2 < tiles.length; is2++) { const s = tiles[is2]!; if (s.on && s.roll <= 0 && (s.type === HEAL || s.type === SHIELD) && Math.sqrt(((s.c + 0.5) * T - u.x) * ((s.c + 0.5) * T - u.x) + ((s.r + 0.5) * T - u.y) * ((s.r + 0.5) * T - u.y)) < 360) (gxx = (s.c + 0.5) * T), (gyy = (s.r + 0.5) * T); }
      for (let i = 0; i < supply.count && gxx < 0; i++) if (supply.landed(i) && Math.sqrt((supply.x[i]! - u.x) * (supply.x[i]! - u.x) + (supply.y[i]! - u.y) * (supply.y[i]! - u.y)) < 420) (gxx = supply.x[i]!), (gyy = supply.y[i]!);
      if (gxx >= 0) (u.gx = gxx), (u.gy = gyy);
      else if (where(u.target)) {
        // Keep a ride's distance: the plane circles close, the tank stands off (a base: up to the wall).
        const keep = u.kind === PLANE ? 120 + R() * 90 : u.target >= MAXF ? 150 + R() * 40 : 170 + R() * 110;
        const a = Math.atan2(u.y - F[QY]!, u.x - F[QX]!) + (R() - 0.5) * (u.kind === PLANE ? 2.4 : 1.4);
        u.gx = Math.max(30, Math.min(W - 30, F[QX]! + Math.cos(a) * keep));
        u.gy = Math.max(70, Math.min(H - 30, F[QY]! + Math.sin(a) * keep));
        if (u.strikes > 0 && R() < 0.18 && (u.target >= MAXF || foes[u.target]!.kind !== FLY)) (F[KX] = F[QX]!), (F[KY] = F[QY]!), callStrike(u.i);
        else if (u.rail > 0 && R() < 0.22 && (u.target >= MAXF || foes[u.target]!.kind === ETANK || foes[u.target]!.tier >= 3)) charge(u, u.target);
      } else if (other.alive) (u.gx = other.x + (R() - 0.5) * 200), (u.gy = other.y + (R() - 0.5) * 160);
      else (u.gx = 60 + R() * (W - 120)), (u.gy = H * 0.5 + R() * H * 0.3);
    }
    const dx = u.gx - u.x, dy = u.gy - u.y;
    F[HX] = dx;
    F[HY] = dy;
    hyp();
    const d = F[HO]!;
    if (d > 16) {
      const before = u.x + u.y;
      (F[DX] = dx / d), (F[DY] = dy / d), (F[DT] = dt * (u.kind === PLANE ? 0.8 : 0.85)), drive(u);
      if (u.kind === TANK && Math.abs(u.x + u.y - before) < 0.01) u.think = Math.min(u.think, 0.05);
    } else if (u.kind === PLANE) (F[DX] = 0), (F[DY] = 0), (F[DT] = dt), fly(u);
    if (where(u.target)) {
      const aim = Math.atan2(F[QY]! - u.y, F[QX]! - u.x);
      (F[TT] = aim), (F[TM] = (u.kind === PLANE ? 7 : 4.5) * dt), turretF(u);
      const err = Math.abs(Math.atan2(Math.sin(aim - u.ta), Math.cos(aim - u.ta)));
      F[HX] = F[QX]! - u.x;
      F[HY] = F[QY]! - u.y;
      hyp();
      if (u.cool <= 0 && u.charge <= 0 && err < 0.14 && F[HO]! < (u.kind === PLANE ? 520 : 470)) fire(u);
    } else (F[TT] = u.a), (F[TM] = 3 * dt), turretF(u);
  }
  // ---------- Squad play: one 32-bit input word per person per frame ----------
  // Bits 0-1 drive x (1 left, 2 right), 2-3 drive y (1 up, 2 down), 4 fire, 5 the special (long shot
  // or salvo), 6 an airstrike at the pointer, 7-8 aim (0 the pointer, 1 auto, 2 along the hull),
  // 9 the ride (0 tank, 1 plane: read in the countdown), 16-23 / 24-31 the pointer in 256ths of the
  // arena. Every peer runs the same human() on the same words (Blitz's net play).
  function human(u: Unit, b: number) {
    const dt = G[DTS]!, mx = b & 3, my = (b >>> 2) & 3, am = (b >>> 7) & 3;
    const px = (((b >>> 16) & 255) + 0.5) * (W / 256), py = (((b >>> 24) & 255) + 0.5) * (H / 256);
    (F[DX] = mx === 1 ? -1 : mx === 2 ? 1 : 0), (F[DY] = my === 1 ? -1 : my === 2 ? 1 : 0), (F[DT] = dt), drive(u);
    const aim = am === 1 ? pick(u, u.x, u.y, 520) : -1;
    if (aim >= 0 && where(aim)) (F[TT] = Math.atan2(F[QY]! - u.y, F[QX]! - u.x)), (F[TM] = (u.kind === PLANE ? 12 : 8) * dt), turretF(u);
    else if (am === 0) (F[TT] = Math.atan2(py - u.y, px - u.x)), (F[TM] = (u.kind === PLANE ? 14 : 10) * dt), turretF(u);
    else (F[TT] = u.a), (F[TM] = 4 * dt), turretF(u);
    if (b & 16 && u.cool <= 0 && u.hot <= 0 && u.charge <= 0) fire(u);
    if (b & 32) charge(u, aim >= 0 ? aim : pick(u, px, py, 9999));
    if (b & 64) (F[KX] = px), (F[KY] = py), callStrike(u.i);
  }
  /** This screen's controls as one input word (taps are spent here, once). */
  function encode() {
    let ax = input.axis("left", "right", 0), ay = input.axis("up", "down", 1);
    const touch = input.stick.active || coarse.matches;
    // A turned view: up on the screen is left in the arena, right on the screen is up.
    if (view[3]) (ay = -ax), (ax = input.axis("up", "down", 1));
    let b = (ax < -0.3 ? 1 : ax > 0.3 ? 2 : 0) | ((ay < -0.3 ? 1 : ay > 0.3 ? 2 : 0) << 2);
    if (!targeting && (input.down("fire") || input.pointer.down || fireQ)) b |= 16;
    fireQ = false;
    if (longQ) (longQ = false), (b |= 32);
    if (strikeT) (strikeT = false), (targeting = !targeting && you.strikes > 0);
    let x = wx(input.pointer.x), y = wy(input.pointer.y);
    if (strikeQ) (strikeQ = false), (targeting = false), (b |= 64), (x = wx(strikeX, strikeY)), (y = wy(strikeY, strikeX));
    if (you.strikes <= 0) targeting = false;
    b |= (autoOn || lockOn ? 1 : !touch || input.pointer.down ? 0 : 2) << 7;
    b |= ride << 9;
    const qx = Math.max(0, Math.min(255, Math.floor((x / W) * 256))), qy = Math.max(0, Math.min(255, Math.floor((y / H) * 256)));
    return (b | (qx << 16) | (qy << 24)) >>> 0;
  }
  // A hash of the match (the crew, every foe and site, the clock, the random's state), compared
  // across peers every 30 frames: a desync shows up as the first frame that differs.
  const hb = new Float64Array(1), hbytes = new Uint8Array(hb.buffer), hs = new Uint32Array(1);
  function mix(v: number) {
    hb[0] = v;
    for (let i = 0; i < 8; i++) hs[0] = Math.imul(hs[0]! ^ hbytes[i]!, 16777619);
  }
  function worldHash() {
    hs[0] = 0x811c9dc5;
    mix(R.state), mix(G[WAVE]!), mix(G[PHASE]!), mix(G[SCORE]!), mix(G[DROPS]!), mix(state === "play" ? 1 : state === "count" ? 2 : state === "end" ? 3 : 0);
    for (let i = 0; i < CN; i++) {
      const u = crew[i]!;
      mix(u.kind), mix(u.x), mix(u.y), mix(u.ta), mix(u.hp), mix(u.alive ? 1 : 0), mix(u.kills), mix(u.rail), mix(u.strikes);
    }
    for (let i = 0; i < MAXF; i++) if (foes[i]!.on) mix(foes[i]!.x), mix(foes[i]!.y), mix(foes[i]!.hp);
    for (let i = 0; i < SITES; i++) if (sites[i]!.on) mix(sites[i]!.hp);
    for (let i = 0; i < shells.length; i++) if (shells[i]!.on) mix(shells[i]!.x);
    return hs[0]! >>> 0;
  }
  /** A frog has its tongue on u's spot (the tell): u gets out of the way. True while it's dodging. */
  function dodge(u: Unit) {
    for (let i = 0; i < MAXF; i++) {
      const f = foes[i]!;
      if (!f.on || f.kind !== FROG || f.mode !== 1) continue;
      const dx = u.x - f.gx, dy = u.y - f.gy, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 70 * scale) continue;
      (F[DX] = d ? dx / d : 1), (F[DY] = d ? dy / d : 0), (F[DT] = G[DTS]!), drive(u);
      return true;
    }
    return false;
  }
  /**
   * The seam: the one place a ride's controls come from. You (this screen's input) or the AI.
   * A second human later (presence, lockstep like Blitz's net play) plugs in here: decode their
   * input word for crew[1] instead of calling ai(). Nothing else in the match knows who drives.
   */
  function pilot(u: Unit) {
    if (!u.human) ai(u);
    else if (net) human(u, netIn[u.i]!);
    else player();
  }

  // ---------- Foes ----------
  /** The nearest live ride to (x, y) (ground only when `ground`), into F[QX], F[QY]; its index or -1. */
  function nearestRide(o: { x: number; y: number }, ground: boolean) {
    const x = o.x, y = o.y;
    let best = -1, bd = 1e9;
    for (let i = 0; i < CN; i++) {
      const u = crew[i]!;
      if (!u.alive || u.drop < 1 || (ground && u.kind === PLANE)) continue;
      const d = Math.sqrt((u.x - x) * (u.x - x) + (u.y - y) * (u.y - y));
      if (d < bd) (bd = d), (best = i);
    }
    if (best >= 0) (F[QX] = crew[best]!.x), (F[QY] = crew[best]!.y);
    return best;
  }
  /** Steer foe f toward (F[QX], F[QY]) at `sp` px/s with `grip` (how fast it turns its velocity). */
  /** Steer foe f toward (F[QX], F[QY]) at F[SPD] px/s with grip F[GRIP] (how fast it turns its velocity). */
  function steerF(f: Foe) {
    const sp = F[SPD]!, grip = F[GRIP]!, dt = G[DTS]!, dx = F[QX]! - f.x, dy = F[QY]! - f.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    f.vx += ((dx / d) * sp - f.vx) * Math.min(1, grip * dt);
    f.vy += ((dy / d) * sp - f.vy) * Math.min(1, grip * dt);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (f.vx * f.vx + f.vy * f.vy > 4) f.a = Math.atan2(f.vy, f.vx);
  }
  /** Swarm Protocol's bug: find a letter, chew it into binary, grow at 6 and 12; a hunter goes for you. */
  function bugStep(f: Foe, idx: number) {
    const dt = G[DTS]!;
    f.t += dt;
    const sp = (70 + f.tier * 18 + G[LVL]! * 8) * (scale / 1.4);
    if (f.tier < 3 && glyphs) {
      if (f.food < 0 || gate[f.food]) {
        // The nearest uneaten, unreserved letter.
        let best = -1, bd = 1e9;
        for (let g = 0; g < glyphs; g++) {
          if (gate[g] || (gres[g]! >= 0 && gres[g] !== idx)) continue;
          const d = Math.abs(gx[g]! - f.x) + Math.abs(gy[g]! - f.y);
          if (d < bd) (bd = d), (best = g);
        }
        if (f.food >= 0 && gres[f.food] === idx) gres[f.food] = -1;
        f.food = best;
        if (best >= 0) gres[best] = idx;
      }
      if (f.food >= 0) {
        F[QX] = gx[f.food]!;
        F[QY] = gy[f.food]! - 4;
        if (Math.sqrt((F[QX]! - f.x) * (F[QX]! - f.x) + (F[QY]! - f.y) * (F[QY]! - f.y)) < 8) {
          // Chew (Swarm: 0.24 s a letter), then the letter turns into a 0 or a 1.
          f.vx = f.vy = 0;
          if ((f.cool -= dt) <= 0) {
            gate[f.food] = 1 + ((R() * 2) | 0);
            gres[f.food] = -1;
            f.food = -1;
            f.cool = 0.24;
            f.eaten++;
            if (f.eaten === 6 || f.eaten === 12) {
              f.tier++;
              f.hp += 1;
              f.max += 1;
              ((FQ[0] = f.x), (FQ[1] = f.y - 20), (FQ[2] = f.tier === 3 ? W_HUNTER : W_GROWN), (FQ[3] = f.tier === 3 ? 3 : 2), (FQ[4] = 14), fxPush(FX_WORD));
              ((FQ[0] = 2), (FQ[1] = f.x), (FQ[2] = f.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 16), (FQ[6] = 0.4), (FQ[7] = f.tier === 3 ? 3 : 2), fxPush(FX_SPAWN));
            }
          }
          return;
        }
        f.cool = 0.24;
        return void (F[SPD] = sp), (F[GRIP] = 6), steerF(f);
      }
    }
    // A hunter (or a bug with nothing left to eat): straight at the nearest ride.
    if (nearestRide(f, false) < 0) return;
    (F[SPD] = sp * (f.tier >= 3 ? 1.15 : 1)), (F[GRIP] = 4), steerF(f);
  }
  /** Null Invaders' alien: holds a slot near its factory, swoops at you, drops bolts. */
  function alienStep(f: Foe) {
    const dt = G[DTS]!;
    f.t += dt;
    f.think -= dt;
    const target = nearestRide(f, false);
    if (f.think <= 0) {
      f.think = 1.4 + R() * 1.6;
      f.mode = target >= 0 && R() < 0.55 ? 1 : 0;
      const home = f.home >= 0 && sites[f.home]!.on && sites[f.home]!.hp > 0 ? sites[f.home]! : null;
      if (f.mode === 1 && target >= 0) {
        const a = R() * TAU, r = 110 + R() * 120;
        f.gx = F[QX]! + Math.cos(a) * r;
        f.gy = F[QY]! + Math.sin(a) * r * 0.6 - 60;
      } else if (home) (f.gx = home.x + (R() - 0.5) * 260), (f.gy = home.y - 40 + (R() - 0.5) * 120);
      else (f.gx = 60 + R() * (W - 120)), (f.gy = 90 + R() * H * 0.4);
      f.gx = Math.max(30, Math.min(W - 30, f.gx));
      f.gy = Math.max(70, Math.min(H - 40, f.gy));
    }
    F[QX] = f.gx + Math.sin(f.t * 2 + f.sub) * 26;
    F[QY] = f.gy;
    (F[SPD] = (110 - f.sub * 18) * (scale / 1.4)), (F[GRIP] = 2.4), steerF(f);
    f.a = Math.PI / 2;
    if ((f.cool -= dt) <= 0 && target >= 0) {
      f.cool = 1.8 + R() * 1.6 - Math.min(0.8, G[LVL]! * 0.15);
      const u = crew[target]!;
      if (Math.sqrt((u.x - f.x) * (u.x - f.x) + (u.y - f.y) * (u.y - f.y)) < 420) {
        F[SX] = f.x;
        F[SY] = f.y + 10;
        // The mothership fires a fan of three.
        for (let n = f.boss ? -1 : 0; n <= f.boss; n++) ((F[SA] = Math.atan2(u.y - f.y, u.x - f.x) + n * 0.3 + (R() - 0.5) * 0.2), (F[SS] = 250), (F[SL] = 2.2), shoot(-1, true, K_ALIEN));
      }
    }
  }
  /** Sherman Bytes' enemy tank: drives at your tank (or the plane's shadow), turret on you, fires. */
  function etankStep(f: Foe) {
    const dt = G[DTS]!;
    f.think -= dt;
    f.cool -= dt;
    f.recoil = Math.max(0, f.recoil - dt * 30);
    const target = nearestRide(f, true) >= 0 ? 1 : nearestRide(f, false) >= 0 ? 2 : 0;
    if (!target) return;
    const tx = F[QX]!, ty = F[QY]!;
    if (f.think <= 0) {
      f.think = 0.8 + R() * 1.2;
      const a = Math.atan2(f.y - ty, f.x - tx) + (R() - 0.5) * 1.6, keep = 150 + R() * 140;
      f.gx = Math.max(30, Math.min(W - 30, tx + Math.cos(a) * keep));
      f.gy = Math.max(70, Math.min(H - 30, ty + Math.sin(a) * keep));
    }
    const dx = f.gx - f.x, dy = f.gy - f.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 16) {
      (F[DX] = dx / d), (F[DY] = dy / d), (F[DT] = dt);
      (dv[0] = f.x), (dv[1] = f.y), (dv[2] = f.a), (F[SPD] = (92 + G[LVL]! * 8) * (f.boss ? 0.7 : 1)), driveF(dv);
      if (Math.abs(dv[0]! - f.x) + Math.abs(dv[1]! - f.y) < 0.01) f.think = Math.min(f.think, 0.1);
      f.x = dv[0]!;
      f.y = dv[1]!;
      f.a = dv[2]!;
      f.tread += dv[3]! * 0.15;
    }
    const aim = Math.atan2(ty - f.y, tx - f.x);
    (F[TT] = aim), (F[TM] = 2.6 * dt), turretF(f);
    const err = Math.abs(Math.atan2(Math.sin(aim - f.ta), Math.cos(aim - f.ta)));
    // Enemy shells are ground fire: they only hit your tank (the plane is out of their reach).
    if (target === 1 && f.cool <= 0 && err < 0.12 && Math.sqrt((tx - f.x) * (tx - f.x) + (ty - f.y) * (ty - f.y)) < 430) {
      f.cool = 1.5 + R() * 1.1;
      F[SX] = f.x + Math.cos(f.ta) * 30;
      F[SY] = f.y + Math.sin(f.ta) * 30;
      // The heavy fires three shells.
      for (let n = f.boss ? -1 : 0; n <= f.boss; n++) ((F[SA] = f.ta + n * 0.18 + (R() - 0.5) * 0.08), (F[SS] = 430), (F[SL] = 1.2), shoot(-1, true, K_ETANK));
      f.recoil = 6;
      ((FQ[0] = 1), (FQ[1] = F[SX]!), (FQ[2] = F[SY]!), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 8), (FQ[6] = 0.12), (FQ[7] = 2), fxPush(FX_SPAWN));
      e.events.emit("shot", -1);
    }
  }
  /** Byte Runner's fly: goes for the pellets on the blocks (each one eaten: tougher, faster, bigger),
   *  else chases you (violet straight at you, pink where you're going, cyan wherever). */
  function flyStep(f: Foe) {
    const dt = G[DTS]!;
    f.t += dt;
    const sp = (140 + G[LVL]! * 10 + (f.tier - 1) * 30) * (scale / 1.4);
    const k = nearestRide(f, false), rx = F[QX]!, ry = F[QY]!;
    const food = f.tier < 3 ? nearestPellet(f, 380) : -1;
    if (food >= 0 && (k < 0 || (F[QX]! - f.x) ** 2 + (F[QY]! - f.y) ** 2 < ((rx - f.x) ** 2 + (ry - f.y) ** 2) * 1.4)) {
      if (Math.abs(F[QX]! - f.x) < 10 && Math.abs(F[QY]! - f.y) < 10) {
        eatPellet(food);
        f.eaten++;
        f.tier = Math.min(3, f.tier + 1);
        f.max++;
        f.hp++;
        ((FQ[0] = f.x), (FQ[1] = f.y - 22), (FQ[2] = W_GULP), (FQ[3] = 8), (FQ[4] = 13), fxPush(FX_WORD));
      }
    } else {
      if (k < 0) return;
      const u = crew[k]!;
      if (f.sub === 1) (F[QX] = u.x + Math.cos(u.a) * 90), (F[QY] = u.y + Math.sin(u.a) * 90);
      else if (f.sub === 2) (F[QX] = u.x + Math.cos(f.t * 1.7) * 110), (F[QY] = u.y + Math.sin(f.t * 1.3) * 110);
      else (F[QX] = rx), (F[QY] = ry);
    }
    (F[SPD] = sp), (F[GRIP] = 3.2), steerF(f);
    f.x = Math.max(16, Math.min(W - 16, f.x));
    f.y = Math.max(56, Math.min(H - 16, f.y));
  }
  /** Byte Runner's frog: hops from pellet to pellet and grows with each one. At four pellets it's big
   *  enough to eat a ride: it stops, its tongue marks the spot for a beat (the tell), then strikes:
   *  whatever is still on the spot is eaten whole. */
  function frogStep(f: Foe) {
    const dt = G[DTS]!;
    f.t += dt;
    f.cool -= dt;
    const size = 1 + Math.min(1.2, f.eaten * 0.15), big = f.eaten >= 4;
    if (f.mode === 1) {
      f.vx = f.vy = 0;
      if ((f.think -= dt) <= 0) {
        f.mode = 2;
        f.think = 0.25;
        for (let k = 0; k < CN; k++) {
          const u = crew[k]!;
          if (!u.alive || u.drop < 1) continue;
          const dx = u.x - f.gx, dy = u.y - f.gy;
          if (dx * dx + dy * dy > (34 * scale) ** 2) continue;
          if (u.shield > 0) {
            ((FQ[0] = 2), (FQ[1] = u.x), (FQ[2] = u.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 24), (FQ[6] = 0.3), (FQ[7] = 4), fxPush(FX_SPAWN));
            continue;
          }
          u.hp = 0;
          ((FQ[0] = u.x), (FQ[1] = u.y - 40), (FQ[2] = W_EATEN), (FQ[3] = 3), (FQ[4] = 24), fxPush(FX_WORD));
          wreck(u);
        }
      }
      return;
    }
    if (f.mode === 2) {
      if ((f.think -= dt) <= 0) (f.mode = 0), (f.cool = 2.4);
      return;
    }
    const k = nearestRide(f, false);
    if (big && k >= 0 && f.cool <= 0 && (F[QX]! - f.x) ** 2 + (F[QY]! - f.y) ** 2 < ((110 + 30 * size) * scale) ** 2) {
      // The tell: the tongue marks where the ride is now.
      f.mode = 1;
      f.think = 0.9;
      f.gx = F[QX]!;
      f.gy = F[QY]!;
      f.a = f.gx < f.x ? Math.PI : 0;
      e.events.emit("lock", -1);
      return;
    }
    // Hungry: the nearest pellet; a big frog goes for you when you're close.
    const food = nearestPellet(f, 2000);
    if (food < 0 || (big && k >= 0 && (crew[k]!.x - f.x) ** 2 + (crew[k]!.y - f.y) ** 2 < (320 * scale) ** 2)) {
      if (k < 0) return;
      (F[QX] = crew[k]!.x), (F[QY] = crew[k]!.y);
    } else if (Math.abs(F[QX]! - f.x) < 14 * size && Math.abs(F[QY]! - f.y) < 14 * size) {
      eatPellet(food);
      frogGrows(f);
      ((FQ[0] = f.x), (FQ[1] = f.y - 34 * size), (FQ[2] = W_GULP), (FQ[3] = 5), (FQ[4] = 16), fxPush(FX_WORD));
    }
    // Hops: a burst toward the goal, then a sit.
    if ((f.u -= dt) <= -0.35) {
      const dx = F[QX]! - f.x, dy = F[QY]! - f.y, d = Math.sqrt(dx * dx + dy * dy) || 1, sp = (170 + G[LVL]! * 12) * (scale / 1.4);
      f.u = 0.32;
      f.vx = (dx / d) * sp;
      f.vy = (dy / d) * sp;
      if (dx) f.a = dx < 0 ? Math.PI : 0;
    }
    if (f.u > 0) (f.x += f.vx * dt), (f.y += f.vy * dt);
    else f.vx = f.vy = 0;
    f.x = Math.max(20, Math.min(W - 20, f.x));
    f.y = Math.max(60, Math.min(H - 20, f.y));
  }
  /** Sites: factories release aliens (up to 5 each at a time); bases sortie tanks and shoot back. */
  function siteStep(s: Site, idx: number) {
    const dt = G[DTS]!;
    s.flash = Math.max(0, s.flash - dt);
    if (s.hp <= 0) {
      // A taken base repairs your rides parked in it (Sherman Bytes: friendly bases repair).
      if (s.kind === BASE && s.won)
        for (let i = 0; i < CN; i++) {
          const u = crew[i]!;
          if (u.alive && u.drop >= 1 && u.hp < MAXHP[u.kind]! && Math.abs(u.x - s.x) < s.w && Math.abs(u.y - s.y) < s.h * 1.6 && (s.cool -= dt) <= 0)
            (s.cool = 1.2), u.hp++, ((FQ[0] = u.x), (FQ[1] = u.y - 30), (FQ[2] = W_REPAIR), (FQ[3] = 5), (FQ[4] = 14), fxPush(FX_WORD));
        }
      return;
    }
    let mine = 0;
    for (let i = 0; i < MAXF; i++) if (foes[i]!.on && foes[i]!.home === idx) mine++;
    if ((s.t -= dt) <= 0) {
      if (s.kind === FACTORY && mine < 6) {
        s.t = 2.6 - Math.min(1, G[LVL]! * 0.25);
        addFoe(ALIEN, s.x + (R() - 0.5) * s.w * 0.6, s.y - s.h / 2, (R() * 3) | 0, idx);
        ((FQ[0] = 2), (FQ[1] = s.x), (FQ[2] = s.y - s.h / 2), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 18), (FQ[6] = 0.35), (FQ[7] = 4), fxPush(FX_SPAWN));
      } else if (s.kind === BASE && mine < 3) {
        // Out through the gap below the base.
        s.t = 5.5 - Math.min(2, G[LVL]! * 0.5);
        const i = addFoe(ETANK, s.x + (s.out++ % 2 ? -1 : 1) * (s.w / 2 + T * 0.9), s.y + s.h / 2 + T * 0.9, 0, idx);
        if (i >= 0) foes[i]!.a = foes[i]!.ta = Math.PI / 2;
      } else s.t = 1;
      if (s.kind === BASE && s.out < 2) s.t = 0.6; // a squad of two rolls out first
    }
    // A base's core has a gun: shells at your tank, flak at the plane.
    if (s.kind === BASE && (s.cool -= dt) <= 0) {
      s.cool = 1.6;
      const k = nearestRide(s, false);
      if (k >= 0 && Math.sqrt((F[QX]! - s.x) * (F[QX]! - s.x) + (F[QY]! - s.y) * (F[QY]! - s.y)) < 340) {
        const u = crew[k]!;
        F[SX] = s.x;
        F[SY] = s.y;
        ((F[SA] = Math.atan2(u.y - s.y, u.x - s.x)), (F[SS] = u.kind === PLANE ? 330 : 420), (F[SL] = 1.1), shoot(-1, true, u.kind === PLANE ? K_FLAK : K_ETANK));
      }
    }
  }

  /** Shell s, going to (F[SX], F[SY]) this step, touches the circle (F[QX], F[QY], F[SR]): swept, inline. */
  function sweep(s: Shell) {
    const x0 = s.x, y0 = s.y, cx = F[QX]!, cy = F[QY]!, r = F[SR]!;
    const dx = F[SX]! - x0, dy = F[SY]! - y0, ox = x0 - cx, oy = y0 - cy;
    const a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - r * r;
    if (c <= 0) return true;
    if (a === 0) return false;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const u = (-b - Math.sqrt(disc)) / (2 * a);
    return u >= 0 && u <= 1;
  }
  /** A ride sits on block b: cover can't grow back yet. */
  function rideOn(b: Block) {
    for (let i = 0; i < CN; i++) {
      const u = crew[i]!;
      if (u.alive && u.kind === TANK && u.x > b.x - 20 && u.x < b.x + b.w + 20 && u.y > b.y - 20 && u.y < b.y + b.h + 20) return true;
    }
    return false;
  }

  e.add({
    read() {
      if (embed && coverDirty && performance.now() - coverAt > 120) { // port-check: ok read phase: throttles page measurement, never feeds the step
        coverDirty = false;
        coverAt = performance.now(); // port-check: ok read phase: as above
        measureCovers();
      }
      if (input.hit("pause")) {
        if (targeting) targeting = false;
        else if (!embed) togglePause();
      }
      if (input.hit("long")) longQ = true;
      if (input.hit("strike")) strikeT = true;
      if (input.hit("auto")) autoOn = !autoOn;
      if (input.hit("lock")) (lockOn = !lockOn), (lockT = -1);
    },
    // Squad play: presence runs world() once per lockstep frame instead.
    step: net ? undefined : (_, dt) => (state === "paused" || G[RES]! > 0 || supply.system.step!(e, dt), world(dt)),
    render() {
      fxPlay();
      for (let i = 0; i < e.events.size; i++) {
        const ev = e.events.at(i)!;
        if (ev.type === "drop:land") fx.spawn(2, ev.x, ev.y, 0, 0, 16, 0.4, 7);
      }
      hudFrame();
      draw();
      if (buzz > 0) {
        try {
          navigator.vibrate?.(Math.min(400, buzz));
        } catch {}
        buzz = 0;
      }
    },
  });
  e.remove(supply.system);
  const link = net
    ? lockstep!(e, { transport: net.transport, slot: net.slot, players: P, delay: net.delay ?? 3, input: net.input ?? encode, step: (_, ins) => ((netIn = ins), world(e.dt)), hash: worldHash })
    : null;

  /** One fixed step of the match. */
  function world(dt: number) {
    G[DTS] = dt; // the step's length, for the helpers (a number passed to a call is boxed)
    if (net && state === "play" && G[RES]! <= 0) supply.system.step!(e, dt);
    // Squad play: everyone's ride, read from their words through the countdown (the same frame on every peer).
    if (net && state === "count") seat();
    G[MATCH]! += dt;
    fx.step(dt);
    G[QUAKE] = Math.max(0, G[QUAKE]! - dt * 40);
    if (state === "intro" || state === "count") {
      // The start screen: the grid lights up with everything that can land on it.
      if ((G[TILE_IN]! -= dt) <= 0) (lightTile(true), (G[TILE_IN] = 0.08 + R() * 0.16));
      for (let is3 = 0; is3 < tiles.length; is3++) { const s = tiles[is3]!;
        if (!s.on) continue;
        if (s.roll > 0) s.roll -= dt;
        else if ((s.t -= dt) <= 0) s.on = false;
      }
      if (state === "count" && (G[CNT]! -= dt) <= 0) {
        for (let is4 = 0; is4 < tiles.length; is4++) { const s = tiles[is4]!; s.on = false; }
        G[TILE_IN] = 1.2;
        begin();
      }
      return;
    }
    if (state !== "play") return;
    if (G[RES]! > 0) return void (G[RES]! -= dt);
    G[PLAYED]! += dt;
    // Out of DROPS: the match ends a beat after you go down.
    if (G[OUT_T]! > 0 && (G[OUT_T]! -= dt) <= 0) return void end(false);
    if (wavesStep()) return;
    boardStep();
    ridesStep();
    foesStep();
    shellsStep();
    airStep();
  }
  // The step, in parts: each its own function, so a rare branch (a wave turning over, the end)
  // can only send its own part back to the interpreter, never the whole step.
  /** The wave: its card, the fight, cleared. True when the match ended. */
  function wavesStep() {
    const dt = G[DTS]!;
    // The wave: its card, the fight, cleared.
    G[WAVE_T]! += dt;
    if (G[PHASE] === P_CARD) {
      if ((G[PH_T]! -= dt) <= 0) (G[PHASE] = P_FIGHT), fightStarts();
    } else if (G[PHASE] === P_FIGHT) {
      if (G[BUGS_LEFT]! > 0 && (G[BUG_IN]! -= dt) <= 0) bugIn(), (G[BUG_IN] = 2.4 + R() * 1.2);
      if (G[FLIES_LEFT]! > 0 && (G[FLY_IN]! -= dt) <= 0) flyIn(), (G[FLY_IN] = 1.3 + R() * 0.8);
      if (cleared()) {
        G[PHASE] = P_CLEAR;
        G[PH_T] = demo ? 1.5 : 2.6;
        const bonus = 300 + Math.max(0, Math.round(120 - G[WAVE_T]!)) * 5, sec = step() === 3 && section() < 4;
        score(bonus);
        // One more drop for each section cleared (not each wave: seventeen waves of drops is too many).
        if (sec && !embed && !demo) G[DROPS]!++;
        (bannerKind = sec ? 3 : 2), (bannerV = bonus), bannerN++;
        e.events.emit("win", 0);
      }
    } else if ((G[PH_T]! -= dt) <= 0) {
      if (!embed && !demo && G[WAVE]! >= WAVES) return end(true), true;
      G[WAVE]!++;
      startWave();
    }
    return false;
  }
  /** Tiles, crates, cover growing back, pellets. */
  function boardStep() {
    const dt = G[DTS]!;
    // Tiles blink in; crates parachute in.
    if ((G[TILE_IN]! -= dt) <= 0) (lightTile(), (G[TILE_IN] = 1.8 + R() * 2.2));
    for (let is5 = 0; is5 < tiles.length; is5++) { const s = tiles[is5]!;
      if (!s.on) continue;
      if (s.roll > 0) s.roll -= dt;
      else if ((s.t -= dt) <= 0) {
        if (s.type === MINE) takeTile(s, null);
        s.on = false;
      }
    }
    if ((G[CRATE_IN]! -= dt) <= 0) (dropCrate(), (G[CRATE_IN] = 20 + R() * 8));
    for (let i = 0; i < coverN; i++) {
      const b = blocks[i]!;
      if (b.hp <= 0 && (b.back -= dt) <= 0 && !rideOn(b) && ((F[BX] = b.x + b.w / 2), (F[BY] = b.y + b.h / 2), (F[BR] = b.w), siteAt() < 0)) b.hp = 3;
    }
    // Eaten pellets come back on another block, on the simulation clock (Byte Runner).
    for (let p = 0; p < pellets; p++) if (!pelOn[p] && (pelBack[p]! -= dt) <= 0) placePellet(p);
  }
  /** Your rides: respawn, land, timers, controls, pickups. */
  function ridesStep() {
    for (let i = 0; i < CN; i++) {
      const u = crew[i]!;
      if (!u.alive || u.drop < 1) rideIn(u);
      else rideStep(u), pickups(u);
    }
    apart();
  }
  /** A ride that's down (respawn when its time is up) or coming in (the parachute, the fly-in). */
  function rideIn(u: Unit) {
    const dt = G[DTS]!;
    if (!u.alive) {
      if (G[OUT_T]! <= 0 && (u.dead -= dt) <= 0) {
        spawn(u);
        if (u.you) e.events.emit("ready", 0);
      }
      return;
    }
    u.drop = Math.min(1, u.drop + dt / (u.kind === PLANE ? 1 : 1.5));
    if (u.drop >= 1) {
      u.shield = Math.max(u.shield, 1.2);
      ((FQ[0] = 2), (FQ[1] = u.x), (FQ[2] = u.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 22), (FQ[6] = 0.45), (FQ[7] = 7), fxPush(FX_SPAWN));
      e.events.emit("land", u.i);
    }
  }
  /** A ride on the board: timers, its controls, the long shot's charge, the edges. */
  function rideStep(u: Unit) {
    const dt = G[DTS]!;
    u.cool -= dt;
    u.shield = Math.max(0, u.shield - dt);
    u.rapid = Math.max(0, u.rapid - dt);
    u.triple = Math.max(0, u.triple - dt);
    u.recoil = Math.max(0, u.recoil - dt * 30);
    u.flash = Math.max(0, u.flash - dt);
    u.hot = Math.max(0, u.hot - dt);
    u.heat = Math.max(0, u.heat - dt * (u.hot > 0 ? 0.7 : 0.45));
    u.bite = Math.max(0, u.bite - dt);
    pilot(u);
    if (u.charge > 0) {
      if (!where(u.chargeT)) u.charge = 0;
      else {
        (F[TT] = Math.atan2(F[QY]! - u.y, F[QX]! - u.x)), (F[TM] = 14 * dt), turretF(u);
        if ((u.charge -= dt) <= 0) fireRail(u);
      }
    }
    if (u.hp <= 2 && R() < dt * 7) ((FQ[0] = 5), (FQ[1] = u.x + (R() - 0.5) * 12), (FQ[2] = u.y - 6), (FQ[3] = (R() - 0.5) * 20), (FQ[4] = -30), (FQ[5] = 10 + R() * 6), (FQ[6] = 0.9), (FQ[7] = 6), fxPush(FX_SPAWN));
    u.x = Math.max(18, Math.min(W - 18, u.x));
    u.y = Math.max(54, Math.min(H - 18, u.y));
    if (u.kind === PLANE) (u.vx = u.x <= 18 || u.x >= W - 18 ? 0 : u.vx), (u.vy = u.y <= 54 || u.y >= H - 18 ? 0 : u.vy);
  }
  /** Tiles and crates under a ride (the plane swoops low enough to grab them). */
  function pickups(u: Unit) {
    for (let is6 = 0; is6 < tiles.length; is6++) { const s = tiles[is6]!;
      if (!s.on || s.roll > 0) continue;
      const x0 = s.c * T, y0 = s.r * T;
      if (u.x >= x0 && u.x <= x0 + T && u.y >= y0 && u.y <= y0 + T && (s.type !== MINE || u.kind === TANK)) takeTile(s, u);
    }
    for (let k = supply.count - 1; k >= 0; k--) if (supply.landed(k) && ((F[HX] = supply.x[k]! - u.x), (F[HY] = supply.y[k]! - u.y), hyp(), F[HO]! < 26 * scale)) takeCrate(k, u);
    if (embed) for (const c of covers) if (u.kind === TANK && inRect(u.x, u.y, c.x, c.y + c.h * 0.2, c.w, c.h * 0.7)) knock(c, 0, 0, 1, true);
  }
  /** The rides keep a little apart (a tank can't sit inside a plane's shadow forever): the plane gives way. */
  function apart() {
    for (let i = 0; i < CN; i++)
      for (let j = i + 1; j < CN; j++) {
        const a = crew[i]!, b = crew[j]!;
        if (!a.alive || !b.alive || a.drop < 1 || b.drop < 1) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy), min = 30 * scale;
        if (d <= 0 || d >= min) continue;
        const k = (min - d) / d;
        if (a.kind === TANK) (b.x += dx * k), (b.y += dy * k);
        else (a.x -= dx * k), (a.y -= dy * k);
      }
  }
  /** Foes and sites: their moves, contact, the factories and bases. */
  function foesStep() {
    const dt = G[DTS]!;
    for (let i = 0; i < MAXF; i++) {
      const f = foes[i]!;
      if (!f.on) continue;
      f.flash = Math.max(0, f.flash - dt);
      if (f.kind === BUG) bugStep(f, i);
      else if (f.kind === ALIEN) alienStep(f);
      else if (f.kind === ETANK) etankStep(f);
      else if (f.kind === FROG) frogStep(f);
      else flyStep(f);
      if (!f.on) continue;
      // Contact: bugs bite, flies sting, a small frog bites; your tank squashes small bugs.
      if (f.kind === BUG || f.kind === FLY || (f.kind === FROG && f.eaten < 4))
        for (let k = 0; k < CN; k++) {
          const u = crew[k]!;
          if (!u.alive || u.drop < 1) continue;
          F[HX] = u.x - f.x;
          F[HY] = u.y - f.y;
          hyp();
          if (F[HO]! > (f.kind === FROG ? 26 : 20) * scale) continue;
          if (f.kind === BUG && u.kind === TANK && f.tier < 3 && !f.boss) {
            ((F[AMT] = 99), hurtFoe(f, k));
            ((FQ[0] = f.x), (FQ[1] = f.y - 16), (FQ[2] = W_SQUASH), (FQ[3] = 2), (FQ[4] = 13), fxPush(FX_WORD));
            break;
          }
          if (u.bite <= 0) (u.bite = 0.9), damage(u, 1);
        }
    }
    for (let i = 0; i < SITES; i++) if (sites[i]!.on) siteStep(sites[i]!, i);
  }
  /** Shells: swept hits so fast shots never pass through. */
  function shellsStep() {
    const dt = G[DTS]!;
    // Guided rounds home in and punch through cover.
    for (let is7 = 0; is7 < shells.length; is7++) { const s = shells[is7]!;
      if (!s.on) continue;
      if (s.rail && where(s.tgt)) {
        F[TF] = Math.atan2(s.vy, s.vx);
        F[TT] = Math.atan2(F[QY]! - s.y, F[QX]! - s.x);
        F[TM] = (s.kind === K_RAIL && crew[s.owner]!.kind === PLANE ? 7 : 5) * dt;
        turnF();
        const na = F[TO]!;
        F[HX] = s.vx;
        F[HY] = s.vy;
        hyp();
        const sp = Math.min(1500, F[HO]! * (1 + dt * 1.6));
        s.vx = Math.cos(na) * sp;
        s.vy = Math.sin(na) * sp;
      } else if (s.rail) s.tgt = -1;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
      s.life -= dt;
      let done = s.life <= 0 || nx < -20 || ny < -20 || nx > W + 20 || ny > H + 20;
      F[SX] = nx;
      F[SY] = ny;
      if (s.foe) {
        // Enemy fire: alien bolts and flak hit both rides; tank shells only your tank.
        F[SR] = (s.kind === K_FLAK ? 22 : 14) * scale;
        for (let k = 0; k < CN && !done; k++) {
          const u = crew[k]!;
          if (!u.alive || u.drop < 1 || (s.kind === K_ETANK && u.kind === PLANE)) continue;
          if (((F[QX] = u.x), (F[QY] = u.y), sweep(s))) {
            done = true;
            ((FQ[0] = u.x), (FQ[1] = u.y), (FQ[2] = s.kind === K_FLAK ? 1 : 0.8), (FQ[3] = s.kind === K_ALIEN ? 3 : 2), boomQ());
            damage(u, 1);
          }
        }
        if (!done && s.kind === K_ETANK) {
          F[BX] = nx;
          F[BY] = ny;
          F[BR] = 2;
          const b = blockedF();
          if (b && b.site < 0) (done = true), ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 0.7), (FQ[3] = 2), boomQ()), --b.hp <= 0 && wreckBlock(b);
        }
      } else {
        const owner = crew[s.owner]!;
        F[SR] = (s.kind === K_BOLT ? 13 : 16) * scale;
        for (let i = 0; i < MAXF && !done; i++) {
          const f = foes[i]!;
          if (!f.on || (s.rail && s.tgt !== i && s.tgt >= 0 && owner.kind === PLANE)) continue;
          if (((F[QX] = f.x), (F[QY] = f.y), sweep(s))) {
            done = true;
            ((FQ[0] = f.x), (FQ[1] = f.y), (FQ[2] = s.rail ? 1.6 : 0.7), (FQ[3] = s.rail ? 1 : s.kind === K_BOLT ? 4 : 2), boomQ());
            hitTarget(i, s.owner, s.kind);
          }
        }
        for (let i = 0; i < SITES && !done; i++) {
          const st = sites[i]!;
          if (!st.on || st.hp <= 0) continue;
          if (Math.abs(nx - st.x) <= st.w / 2 && Math.abs(ny - st.y) <= st.h / 2) {
            done = true;
            ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = s.rail ? 1.6 : 0.6), (FQ[3] = st.kind === FACTORY ? 4 : 1), boomQ());
            hitTarget(MAXF + i, s.owner, s.kind);
          }
        }
        if (!done) {
          // Cover: the tank's shells stop on it (its long shot punches through); the plane's shots fly
          // over cover, but not over base walls.
          F[BX] = nx;
          F[BY] = ny;
          F[BR] = 2;
          const b = blockedF(), high = owner.kind === PLANE;
          if (b && (!high || b.site >= 0)) {
            if (s.rail && !high) hitBlock(b, s.owner, true), ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 1), (FQ[3] = 1), boomQ());
            else (done = true), ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 0.6), (FQ[3] = 2), boomQ()), hitBlock(b, s.owner, false), s.rail && b.hp > 0 && (b.hp -= 0.8) <= 0 && wreckBlock(b);
          }
        }
        if (!done && embed && owner.kind === TANK)
          for (const c of covers)
            if (inRect(nx, ny, c.x, c.y, c.w, c.h) && (s.rail || R() < 0.5)) {
              const d = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || 1;
              knock(c, s.vx / d, s.vy / d, s.rail ? 2 : 1.2, false);
              if (!s.rail) {
                done = true;
                ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 0.9), (FQ[3] = 4), boomQ());
                break;
              }
            }
      }
      if (done) s.on = false;
      else (s.x = nx), (s.y = ny);
    }
  }
  /** Airstrikes: bombers fly, bombs drop, blasts follow up. */
  function airStep() {
    const dt = G[DTS]!;
    // Airstrikes: bombers fly, bombs drop, blasts follow up.
    for (let ip8 = 0; ip8 < bombers.length; ip8++) { const p = bombers[ip8]!; if (p.on && (p.t -= dt) <= 0) p.on = false; }
    for (let ip9 = 0; ip9 < bombers.length; ip9++) { const p = bombers[ip9]!; if (p.on) (p.x += p.vx * dt), (p.y += p.vy * dt); }
    for (let ib10 = 0; ib10 < bombs.length; ib10++) { const b = bombs[ib10]!;
      if (!b.on) continue;
      if (b.wait > 0) b.wait -= dt;
      else if ((b.fall -= dt) <= 0) (b.on = false), detonate(b);
    }
    for (let im11 = 0; im11 < marks.length; im11++) { const m = marks[im11]!; if (m.on && (m.t -= dt) <= 0) m.on = false; }
    for (let ib12 = 0; ib12 < booms.length; ib12++) { const b = booms[ib12]!; if (b.on && (b.t -= dt) <= 0) (b.on = false), ((FQ[0] = b.x), (FQ[1] = b.y), (FQ[2] = b.p), (FQ[3] = b.c), boomQ()); }
  }

  // ---------- Taps on the field: an airstrike spot, or a new lock target ----------
  wrap.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.target !== canvas || state !== "play" || demo || !you.alive) return;
      const r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (targeting) {
        ev.stopPropagation();
        strikeQ = true;
        strikeX = x;
        strikeY = y;
        return;
      }
      if (lockOn) {
        const k = pick(you, wx(x, y), wy(y, x), 44 * (scale / 1.4));
        if (k >= 0 && k !== lockT && where(k)) {
          ev.stopPropagation();
          lockT = k;
          fx.word(F[QX]!, F[QY]! - 34, W_LOCK, 4, 14);
          e.events.emit("lock", 0);
        }
      }
    },
    { capture: true, signal: e.signal },
  );

  // ---------- Match flow ----------
  const RIDES = [
    ["tank", "TANK", "Armour. Breaches walls, wrecks tanks, squashes bugs."],
    ["plane", "PLANE", "Speed. Flies over cover, shreds the air and the factories."],
  ] as const;
  const dirKey = $<HTMLButtonElement>("[data-dir]"), dirCard = $<HTMLElement>("#cf-dir"), keyed = () => wrap.classList.contains("nofs");
  const dir = (on: boolean) => ((dirCard.hidden = !on), dirKey.setAttribute("aria-expanded", "" + on));
  dirCard.innerHTML = FACTIONS.slice(0, 4).map(([n, c], k) => `<span><i style="--c:${c}">S${k + 1}</i> <b>${n}</b> ×4</span>`).join("") + `<span><i style="--c:#ff2e88">FINALE</i> <b>ALL FOUR</b></span>`;
  dirKey.addEventListener("click", () => dir(dirCard.hidden as boolean), { signal: e.signal });
  addEventListener("keydown", (ev) => keyed() && !dirCard.hidden && ev.code === "Escape" && (ev.stopPropagation(), dir(false), dirKey.focus()), { capture: true, signal: e.signal });
  wrap.addEventListener("pointerdown", (ev) => keyed() && !dirKey.contains(ev.target as Node) && !dirCard.contains(ev.target as Node) && dir(false), { signal: e.signal });
  /** The keys and the help line for your ride (LONG on the tank, SALVO on the plane). */
  function rideKeys() {
    const plane = you.kind === PLANE;
    $<HTMLElement>("[data-li]").innerHTML = svg(plane ? "salvo" : "long");
    $<HTMLElement>("[data-ll]").textContent = plane ? "SALVO" : "LONG";
    keys.long.setAttribute("aria-label", plane ? "Salvo: four homing rockets (E)" : "Long shot: locks on and hits from across the field (E)");
    keys.long.title = plane ? "E · Salvo" : "E · Long shot";
    $<HTMLElement>("[data-help]").textContent = `WASD ${plane ? "FLY" : "DRIVE"} · MOUSE AIM · CLICK FIRE · E ${plane ? "SALVO" : "LONG SHOT"} · F AIRSTRIKE · Q AUTO · T LOCK${embed ? " · ESC CLOSE" : net ? "" : " · ESC/P PAUSE"}`;
    wrap.style.setProperty("--team", you.color);
    wrap.style.setProperty("--pc", mate.color);
    hud.pn.textContent = mate.name;
    hud.hn.textContent = you.kind === TANK ? "ARMOR" : "HULL";
  }
  function intro() {
    state = "intro";
    G[TILE_IN] = 0;
    wrap.classList.add("pre");
    over.hidden = false;
    over.classList.add("intro");
    dir(!keyed());
    over.innerHTML = `<div class="sticker" role="img" aria-label="DOM Crossfire">${BADGE}<b>CROSS<em>FIRE</em></b><span>CO-OP · 4 SECTIONS + FINALE</span></div>
<div class="pick" role="group" aria-labelledby="cf-pick"><small id="cf-pick">PICK YOUR RIDE</small><div class="rides">${RIDES.map(([id, n, d], k) => `<button class="bui-key ride" type="button" data-ride="${id}" aria-pressed="${k === ride}" style="--rc:${RIDE_COLOR[k]}"><span class="pic">${k === PLANE ? shipSvg() : tankSvg(RIDE_COLOR[TANK]!)}</span><b>${n}</b><small>${d}</small><span class="you" aria-hidden="true">YOU</span></button>`).join("")}</div></div>
<p class="mate" data-mate></p>
<button class="bui-sticker-key bui-call" type="button" data-go aria-label="Press start">${PLAY}<b>PRESS START</b></button>`;
    const mateLine = () => (over.querySelector("[data-mate]")!.textContent = `YOUR AI PARTNER: THE ${RIDE_NAME[1 - ride]}`);
    mateLine();
    over.querySelectorAll<HTMLButtonElement>("[data-ride]").forEach((b, k) =>
      b.addEventListener("click", () => {
        ride = k;
        try {
          localStorage.setItem("crossfire:ride", RIDES[k]![0]);
        } catch {}
        cast();
        rideKeys();
        for (const m of over.querySelectorAll("[data-ride]")) m.setAttribute("aria-pressed", String(m === b));
        mateLine();
        e.events.emit("lock", 0);
      }, { signal: e.signal }));
    const go = over.querySelector<HTMLButtonElement>("[data-go]")!;
    go.addEventListener("click", () => launch(go, countdown, { reduced: calm.matches }), { signal: e.signal });
  }
  function countdown() {
    state = "count";
    dir(false);
    over.classList.remove("intro");
    G[CNT] = 2.4;
    G[RES] = 0;
    over.hidden = false;
    over.innerHTML = `<div class="count" data-c>3</div>`;
    e.events.emit("ready", 0);
  }
  function begin() {
    state = "play";
    wrap.classList.remove("pre");
    over.hidden = true;
    over.innerHTML = "";
    G[WAVE] = 1;
    if (net) rideKeys(); // the squad's rides are settled now
    startWave();
  }
  function end(won: boolean, surrendered = false) {
    state = "end";
    targeting = false;
    const sc = Math.round(G[SCORE]!), wave = Math.min(G[WAVE]!, WAVES);
    e.events.emit(won ? "win" : "end", 0);
    // Solo: you and your partner. Squad: everyone in the crew, you marked.
    const who = net ? crew.slice(0, CN) : [you, mate];
    const rows = `<div class="big you"><span>SCORE</span><span>${sc}</span></div><div><span>WAVES</span><span>${won ? WAVES : wave - 1} / ${WAVES}</span></div>` + who.map((u) => `<div class="${u.you ? "you" : ""}"><span>${u.you ? "YOU" : net ? (u.human ? "SQUAD" : "AI") : "PARTNER"} · ${u.name}${net && u.human ? ` · ${RIDE_NAME[u.kind]}` : ""}</span><span>${u.kills} K · ${u.deaths} D</span></div>`).join("");
    overlay(
      won ? "STAGE CLEAR" : surrendered ? "WHITE FLAG" : "INSERT COIN",
      won ? "YOU WIN" : surrendered ? "GAME OVER" : `WAVE ${wave} WINS`,
      net ? (net.leave ? `<button class="bui-sticker-key" type="button" data-new>${MENU}<b>BACK TO THE ROOM</b></button>` : "") : `<button class="bui-sticker-key" type="button" data-again>${PLAY}<b>PLAY AGAIN</b></button><button class="bui-sticker-key bui-second" type="button" data-new>${MENU}<b>SWAP RIDES</b></button>`,
      `<div class="table">${rows}</div>`,
    );
    ov.querySelector("[data-again]")?.addEventListener("click", () => (closeOverlay(), rematch()), { signal: e.signal });
    ov.querySelector("[data-new]")?.addEventListener("click", () => (net ? net.leave?.() : toIntro()), { signal: e.signal });
    o.onEnd?.({ won, score: sc, wave, ride: RIDE_NAME[ride] === "TANK" ? "tank" : "plane", kills: G[KILLS]!, surrendered });
  }
  /** A fresh match: the board, the crew, the waves. */
  function reset() {
    for (const pool of [shells, tiles, marks, bombers, bombs, booms, foes, sites] as { on: boolean }[][]) for (const s of pool) s.on = false;
    supply.reset();
    targeting = false;
    lockT = -1;
    fx.clear();
    G.fill(0);
    G[DROPS] = 4;
    G[CRATE_IN] = 14;
    pellets = 0;
    for (const u of crew) Object.assign(u, mkUnit(u.i));
    cast();
    rideKeys();
    if (!embed) layBlocks();
  }
  function rematch() {
    reset();
    countdown();
  }
  function toIntro() {
    closeOverlay();
    reset();
    intro();
  }
  const ov = $<HTMLElement>("[data-ov]");
  function overlay(kick: string, wordTxt: string, keysHtml: string, table = "") {
    ov.hidden = false;
    ov.classList.toggle("result", !!table);
    ov.setAttribute("aria-label", `${kick} ${wordTxt}`);
    ov.innerHTML = `<div class="bui-sticker"><span>${kick}</span><b>${wordTxt}</b></div>${table}<div class="bui-overlay-keys">${keysHtml}</div>`;
    slam(ov.querySelector(".bui-sticker"));
    requestAnimationFrame(() => ov.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
  }
  const closeOverlay = () => ((ov.hidden = true), (ov.innerHTML = ""), ov.classList.remove("pause"));
  const BYLINE = `<p class="by">DOM CROSSFIRE · BY CHRIS COOLEY · BUILT ON FIZLET · <a href="https://domvirus.com/legal/privacy/">PRIVACY</a></p>`;
  /** Pause (Blitz): RESUME (a short countdown first), RESTART, QUIT TO MENU, and the white flag. */
  function togglePause() {
    if (net) return; // a squad match can't stop one screen: no pause in squad play
    if (state === "play") {
      state = "paused";
      targeting = false;
      input.press("fire", false);
      overlay("BATTLE PAUSED", "PAUSED", `<button class="bui-sticker-key" type="button" data-resume>${PLAY}<b>RESUME</b></button><button class="bui-sticker-key bui-plan" type="button" data-restart>${AGAIN}<b>RESTART</b></button><button class="bui-sticker-key bui-second" type="button" data-menu>${MENU}<b>QUIT TO MENU</b></button><button class="bui-sticker-key bui-second bui-surrender" type="button" data-surrender>${FLAG}<b>SURRENDER</b></button>${BYLINE}`);
      ov.classList.add("pause");
      ov.querySelector("[data-resume]")!.addEventListener("click", togglePause, { signal: e.signal });
      ov.querySelector("[data-restart]")!.addEventListener("click", () => (closeOverlay(), rematch()), { signal: e.signal });
      ov.querySelector("[data-menu]")!.addEventListener("click", () => toIntro(), { signal: e.signal });
      const flag = ov.querySelector<HTMLButtonElement>("[data-surrender]")!;
      flag.addEventListener("click", () => {
        if (flag.classList.contains("go")) return;
        flag.classList.add("go");
        e.events.emit("strike", 0);
        const reduced = calm.matches;
        setTimeout(() => launch(flag, () => end(false, true), { reduced }), reduced ? 0 : 480);
      }, { signal: e.signal });
    } else if (state === "paused") (closeOverlay(), (state = "play"), (G[RES] = RESUME));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !embed && !demo && !net && state === "play") togglePause();
  }, { signal: e.signal });

  // ---------- HUD (change-only writes, render phase) ----------
  const last = { sc: "", wv: "", wl: "", dr: "", hp: -1, php: -2, sn: "", ln: "", sDis: false, lDis: false, fDis: false, auto: "", lock: "", aim: "", heat: -1, hot: false, count: "", rs: false, wc: "" };
  const FEED_FOE = ["", "BUG", "ALIEN", "TANK", "FLY", "FACTORY", "BASE"];
  function hudFrame() {
    const sc = String(Math.round(G[SCORE]!));
    if (sc !== last.sc) hud.sc.textContent = last.sc = sc;
    const sec = section(), fc = FACTIONS[sec]!, wv = sec === 4 ? "ALL" : `${step() + 1}/${PER}`;
    if (wv !== last.wv) hud.wv.textContent = last.wv = wv;
    const wl = sec === 4 ? "FINALE" : `S${sec + 1} · ${SHORT[sec]}`;
    if (wl !== last.wl) (hud.wl.textContent = last.wl = wl), hud.wv.parentElement!.style.setProperty("--wc", fc[1]);
    const dr = embed ? "∞" : String(G[DROPS]!);
    if (dr !== last.dr) hud.dr.textContent = last.dr = dr;
    const hp = you.alive ? Math.max(0, you.hp) / MAXHP[you.kind]! : 0;
    if (hp !== last.hp) {
      last.hp = hp;
      hud.hp.style.width = `${hp * 100}%`;
      hud.hp.parentElement!.parentElement!.classList.toggle("low", hp <= 0.34);
    }
    const php = mate.alive ? Math.max(0, mate.hp) / MAXHP[mate.kind]! : -1;
    if (php !== last.php) {
      last.php = php;
      hud.php.style.width = `${Math.max(0, php) * 100}%`;
      hud.php.parentElement!.parentElement!.classList.toggle("out", php < 0);
    }
    const sn = String(you.strikes), ln = String(you.rail);
    if (sn !== last.sn) hud.sn.textContent = last.sn = sn;
    if (ln !== last.ln) hud.ln.textContent = last.ln = ln;
    const down = !you.alive || you.drop < 1;
    const sDis = down || you.strikes <= 0, lDis = down || you.rail <= 0, fDis = down;
    if (sDis !== last.sDis) keys.strike.disabled = last.sDis = sDis;
    if (lDis !== last.lDis) keys.long.disabled = last.lDis = lDis;
    if (fDis !== last.fDis) keys.fire.disabled = last.fDis = fDis;
    const au = String(autoOn), lo = String(lockOn), ai2 = String(targeting);
    if (au !== last.auto) keys.auto.setAttribute("aria-pressed", (last.auto = au));
    if (lo !== last.lock) keys.lock.setAttribute("aria-pressed", (last.lock = lo));
    if (ai2 !== last.aim) {
      keys.strike.setAttribute("aria-pressed", (last.aim = ai2));
      tip.hidden = !targeting;
      wrap.classList.toggle("aiming", targeting);
    }
    const heat = Math.round((you.hot > 0 ? 1 : you.heat) * 20) / 20, hot = you.hot > 0;
    if (heat !== last.heat) keys.fire.style.setProperty("--h", String((last.heat = heat)));
    if (hot !== last.hot) keys.fire.classList.toggle("hot", (last.hot = hot));
    // The feed: who wrecked what, supply calls, a ride going down.
    for (; feedShown < feedN; feedShown++) {
      const li = feed[feedShown % feed.length]!, a = feedK[feedShown % 8]!, v = feedV[feedShown % 8]!;
      const tag = (u: Unit) => `<i style="color:${u.color}">${u.you ? "YOU" : u.name}</i>`;
      li.innerHTML = a === -9 ? `📦 SUPPLY DROP · ${["MEDKIT", "LONG AMMO", "AIRSTRIKE", "JACKPOT"][v]}` : a < 0 ? `${tag(crew[-1 - a]!)} DOWN${crew[-1 - a]!.you && !embed ? ` · ${G[DROPS]!} DROPS LEFT` : ""}` : `${tag(crew[a]!)} ✕ ${FEED_FOE[v]}`;
      li.parentElement!.prepend(li);
      li.animate?.([{ opacity: 0, transform: "translateX(20px)" }, { opacity: 1, transform: "none" }], { duration: 200 });
    }
    // The banner: a kill streak, a weapon tier, a wave cleared.
    if (bannerShown !== bannerN) {
      bannerShown = bannerN;
      banner.querySelector("b")!.textContent = bannerKind === 0 ? `${bannerV} KILL STREAK` : bannerKind === 1 ? `${TIER_NAME[bannerV]} GUNS` : bannerKind === 3 ? "SECTION CLEAR" : "WAVE CLEAR";
      banner.querySelector("span")!.textContent = bannerKind === 0 ? STREAK[bannerV]! : bannerKind === 1 ? "WEAPON TIER UP" : `+${bannerV}${bannerKind === 3 && !embed ? " · +1 DROP" : ""}`;
      banner.animate?.(
        [{ opacity: 0, transform: "scale(2.2)" }, { opacity: 1, transform: "scale(.94)", offset: 0.12 }, { opacity: 1, transform: "scale(1)", offset: 0.2 }, { opacity: 1, transform: "scale(1)", offset: 0.82 }, { opacity: 0, transform: "scale(.9) translateY(-14px)" }],
        { duration: 2200, easing: "ease-out" },
      );
    }
    // The wave card: the faction, its art, what it does, each ride's job.
    if (waveShown !== waveN) {
      waveShown = waveN;
      const sec = section(), k = step(), [name, c, line, pj, tj, boss] = FACTIONS[sec]!;
      const where = sec === 4 ? "FINALE · ALL FOUR ARMIES" : `SECTION ${sec + 1} · WAVE ${k + 1}/${PER}`;
      waveCard.style.setProperty("--fc", c);
      waveCard.innerHTML = `<span class="art">${factionSvg(sec)}</span><small>${where}</small> <b>${name}</b> <p>${k === 3 && sec < 4 ? `MINI-BOSS: ${boss}. ` : ""}${line}</p> <div class="jobs"><span style="--c:${RIDE_COLOR[PLANE]}">PLANE · ${pj}</span> <span style="--c:${RIDE_COLOR[TANK]}">TANK · ${tj}</span></div>`;
      if (!demo) {
        const still = calm.matches;
        waveCard.animate?.(
          still
            ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
            : [{ opacity: 0, transform: "scale(1.8) rotate(-6deg)" }, { opacity: 1, transform: "scale(.96)", offset: 0.1 }, { opacity: 1, transform: "scale(1)", offset: 0.16 }, { opacity: 1, transform: "scale(1)", offset: 0.86 }, { opacity: 0, transform: "scale(.92) translateY(-20px)" }],
          { duration: 2900, easing: "ease-out" },
        );
      }
    }
    const rs = state === "play" && G[RES]! > 0;
    if (rs !== last.rs) {
      over.hidden = !(last.rs = rs);
      over.innerHTML = rs ? `<div class="count" data-c></div>` : "";
      last.count = "";
    }
    if (rs) {
      const c = G[RES]! > 2 ? "3" : G[RES]! > 1 ? "2" : "1";
      if (c !== last.count) (last.count = c), (over.querySelector("[data-c]")!.textContent = c);
    }
    if (state === "count") {
      const c = G[CNT]! > 1.6 ? "3" : G[CNT]! > 0.8 ? "2" : G[CNT]! > 0.15 ? "1" : "GO!";
      if (c !== last.count) {
        last.count = c;
        const el = over.querySelector<HTMLElement>("[data-c]");
        if (el) (el.textContent = c), el.getAnimations?.().forEach((a) => (a.cancel(), a.play()));
      }
    }
  }

  // ---------- Drawing ----------
  const LOCATE = 1.4;
  let youUp = false, locateAt = -9;
  /** Find yourself (Blitz): rings ripple out and a YOU chevron drops each time you land. */
  function locatePulse() {
    const now = performance.now() / 1000, up = you.alive && you.drop >= 1; // port-check: ok render: the pulse is drawn only
    if (up && !youUp) locateAt = now;
    youUp = up;
    const lk = now - locateAt;
    if (!up || lk >= LOCATE) return;
    const r0 = 27 * scale, s = scale / 1.4, still = calm.matches;
    for (let k = 0; k < (still ? 1 : 3); k++) {
      const ph = still ? 0.3 : lk / LOCATE - k * 0.2;
      if (ph <= 0 || ph >= 1) continue;
      ctx.globalAlpha = still ? 1 - lk / LOCATE : 1 - ph;
      ctx.beginPath();
      ctx.arc(you.x, you.y, r0 + ph * 120 * s, 0, TAU);
      ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = you.color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const drop = still ? 0 : 10 * Math.abs(Math.sin(lk * 8)) * (1 - lk / LOCATE), y = you.y - r0 - 30 - drop;
    ctx.globalAlpha = Math.min(1, (LOCATE - lk) * 3);
    ctx.beginPath();
    ctx.moveTo(you.x - 11, y - 10);
    ctx.lineTo(you.x + 11, y - 10);
    ctx.lineTo(you.x, y + 3);
    ctx.closePath();
    ctx.fillStyle = you.color;
    ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function jet(x: number, y: number, a: number, s: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(10, -4);
    ctx.lineTo(-2, -26);
    ctx.lineTo(-10, -26);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-16, -4);
    ctx.lineTo(-23, -12);
    ctx.lineTo(-28, -12);
    ctx.lineTo(-24, 0);
    ctx.lineTo(-28, 12);
    ctx.lineTo(-23, 12);
    ctx.lineTo(-16, 4);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-10, 26);
    ctx.lineTo(-2, 26);
    ctx.lineTo(10, 4);
    ctx.closePath();
    ctx.restore();
  }
  function chute(x: number, y: number, sc: number, color: string, sway: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway);
    const cw = 34 * sc, cy = -46 * sc;
    ctx.strokeStyle = "#f6f3ff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const f of [-1, -0.4, 0.4, 1]) (ctx.moveTo(f * cw * 0.95, cy), ctx.lineTo(f * 8 * sc, -8 * sc));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, cy, cw, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#f6f3ff";
    for (let k = -2; k <= 2; k += 2) {
      ctx.beginPath();
      ctx.moveTo(0, cy - cw);
      ctx.lineTo(k * cw * 0.28 - cw * 0.12, cy);
      ctx.lineTo(k * cw * 0.28 + cw * 0.12, cy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "#07060f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, cy, cw, Math.PI, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  function crate(x: number, y: number, s: number, kind: number) {
    const w = 26 * s;
    ctx.fillStyle = "#3a2a14";
    ctx.strokeStyle = "#07060f";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - w / 2, w, w, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = kind === 0 ? "#a8ff3e" : kind === 1 ? "#ffc21a" : kind === 2 ? "#ff2e88" : "#19f0ff";
    ctx.fillRect(x - w / 2 + 3, y - 3 * s, w - 6, 6 * s);
    ctx.fillRect(x - 3 * s, y - w / 2 + 3, 6 * s, w - 6);
    ctx.strokeStyle = "#ffc21a";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - w / 2 + 3, y - w / 2 + 3, w - 6, w - 6);
  }
  function brackets(x: number, y: number, r: number, color: string, width: number) {
    const l = r * 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) (ctx.moveTo(x + sx * r, y + sy * (r - l)), ctx.lineTo(x + sx * r, y + sy * r), ctx.lineTo(x + sx * (r - l), y + sy * r));
    ctx.stroke();
  }
  function reticle(x: number, y: number, r: number, spin: number, alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ff2e88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r - 14, y);
    ctx.lineTo(x - r + 16, y);
    ctx.moveTo(x + r - 16, y);
    ctx.lineTo(x + r + 14, y);
    ctx.moveTo(x, y - r - 14);
    ctx.lineTo(x, y - r + 16);
    ctx.moveTo(x, y + r - 16);
    ctx.lineTo(x, y + r + 14);
    ctx.stroke();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -spin * 40;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.globalAlpha = 1;
  }
  function tileIcon(type: number, x: number, y: number, w: number) {
    const c = x + w / 2, m = y + w / 2, s = w * 0.3;
    ctx.fillStyle = ctx.strokeStyle = type === SHIELD ? "#07060f" : "#f6f3ff";
    ctx.lineWidth = 2.5;
    if (type === HEAL) {
      ctx.fillRect(c - s, m - s * 0.32, s * 2, s * 0.64);
      ctx.fillRect(c - s * 0.32, m - s, s * 0.64, s * 2);
    } else if (type === AMMO) {
      ctx.beginPath();
      ctx.arc(c, m, s * 0.8, 0, TAU);
      ctx.moveTo(c - s * 1.2, m);
      ctx.lineTo(c + s * 1.2, m);
      ctx.moveTo(c, m - s * 1.2);
      ctx.lineTo(c, m + s * 1.2);
      ctx.stroke();
    } else if (type === STRIKE) {
      jet(c, m, -Math.PI / 2, w / 80);
      ctx.fill();
    } else {
      ctx.font = `900 ${Math.round(w * 0.55)}px ui-monospace,monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(type === RAPID ? "»" : type === TRIPLE ? "≡" : type === SHIELD ? "◆" : "!", c, m + 1);
    }
  }
  /** A Byte Runner fly's tier: pips under it (one per pellet it ate). */
  function pips(f: Foe, dy: number, c: string) {
    for (let k = 0; k < f.tier; k++) (ctx.fillStyle = k < f.tier ? c : "rgba(255,255,255,.16)"), ctx.fillRect(f.x - (f.tier * 5 - 2) / 2 + k * 5, f.y + dy, 3, 3);
  }
  /** A mini-boss: its name over it and a long health bar. */
  function bossTag(f: Foe, dy: number) {
    const name = FACTIONS[section() < 4 ? section() : 3]![5];
    ctx.font = "900 11px ui-monospace,monospace";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#07060f";
    ctx.strokeText(name, f.x, f.y - dy - 10);
    ctx.fillStyle = "#ff2b4e";
    ctx.fillText(name, f.x, f.y - dy - 10);
    bar(f.x, f.y - dy - 4, 60, f.hp / f.max, "#ff2b4e");
  }
  /** A health bar over (x, y): `k` of 1, in colour c. */
  function bar(x: number, y: number, w: number, k: number, c: string) {
    ctx.fillStyle = lightTheme ? "rgba(7,6,15,.25)" : "rgba(7,6,15,.75)";
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = c;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, k), 4);
  }
  /** A Board UI key drawn on the board: Null Invaders' factory (a liquid fill drains with its health)
   *  or Sherman Bytes' button base core. */
  function buttonSite(s: Site, now: number) {
    const x = s.x - s.w / 2, y = s.y - s.h / 2, k = Math.max(0, s.hp / s.max), r = 10;
    const face = s.kind === FACTORY ? "#19f0ff" : "#ffc21a", dead = s.hp <= 0;
    // The hard base below (the kit's key), then the face.
    ctx.fillStyle = "#07060f";
    ctx.beginPath();
    ctx.roundRect(x, y + 6, s.w, s.h, r);
    ctx.fill();
    ctx.fillStyle = dead ? (s.won ? "#0f3a2a" : "#1a1430") : lightTheme ? "#f6f3ff" : "#10233f";
    ctx.beginPath();
    ctx.roundRect(x, y, s.w, s.h, r);
    ctx.fill();
    if (!dead) {
      // The liquid: health as a fill that drains, with a wave on top.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, s.w, s.h, r);
      ctx.clip();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = s.flash > 0 ? "#f6f3ff" : face;
      const top = y + s.h * (1 - k);
      ctx.beginPath();
      ctx.moveTo(x, y + s.h);
      for (let i = 0; i <= 12; i++) ctx.lineTo(x + (s.w * i) / 12, top + Math.sin(now * 4 + i * 0.9) * (k < 1 ? 3 : 0));
      ctx.lineTo(x + s.w, y + s.h);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = dead ? (s.won ? "#39ffb0" : "#aea4d6") : s.flash > 0 ? "#f6f3ff" : face;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, s.w, s.h, r);
    ctx.stroke();
    ctx.font = `900 ${Math.round(Math.min(14, s.h * 0.34))}px ui-monospace,monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#07060f";
    const label = dead ? (s.won ? "YOURS" : "0 1 0 1") : LABELS[s.label]!;
    ctx.strokeText(label, s.x, s.y + 1);
    ctx.fillStyle = dead ? (s.won ? "#39ffb0" : "#aea4d6") : "#f6f3ff";
    ctx.fillText(label, s.x, s.y + 1);
    if (!dead && s.kind === FACTORY && s.t < 0.5) {
      // About to release: the spawn lip glows.
      ctx.globalAlpha = 1 - s.t * 2;
      ctx.fillStyle = "#19f0ff";
      ctx.fillRect(s.x - s.w * 0.3, y - 5, s.w * 0.6, 4);
      ctx.globalAlpha = 1;
    }
    if (s.kind === BASE && s.won) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now * 3);
      ctx.strokeStyle = "#39ffb0";
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -now * 20;
      ctx.strokeRect(s.x - s.w, s.y - s.h * 1.6, s.w * 2, s.h * 3.2);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = "alphabetic";
  }
  function draw() {
    if (net) ctx.setTransform(1, 0, 0, 1, 0, 0), ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (view[3]) ctx.setTransform(0, dpr * view[0]!, -dpr * view[0]!, 0, dpr * (view[1]! + H * view[0]!), dpr * view[2]!);
    else ctx.setTransform(dpr * view[0]!, 0, 0, dpr * view[0]!, dpr * view[1]!, dpr * view[2]!);
    ctx.clearRect(0, 0, W, H);
    const sh = calm.matches ? 0 : G[QUAKE]!, sx = sh ? (shakeRandom() - 0.5) * sh : 0, sy = sh ? (shakeRandom() - 0.5) * sh : 0;
    shook = Math.abs(sx) + Math.abs(sy);
    ctx.translate(sx, sy);
    const now = performance.now() / 1000; // port-check: ok render: colour cycles and pulses, drawn only
    if (!embed) {
      ctx.fillStyle = lightTheme ? "#e4e6f7" : "#090818";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.strokeStyle = lightTheme ? "rgba(0,136,179,.22)" : "rgba(25,240,255,.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) (ctx.moveTo(c * T + 0.5, 0), ctx.lineTo(c * T + 0.5, H));
      for (let r = 0; r <= rows; r++) (ctx.moveTo(0, r * T + 0.5), ctx.lineTo(W, r * T + 0.5));
      ctx.stroke();
      // The board's copy: the letters bugs eat. Eaten ones are binary now (Swarm Protocol).
      ctx.font = `800 ${Math.round(T * 0.42)}px ui-monospace,monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let g = 0; g < glyphs; g++) {
        const ate = gate[g]!;
        ctx.globalAlpha = state === "play" && !demo ? 1 : 0.45;
        ctx.fillStyle = ate ? (lightTheme ? "rgba(10,138,85,.7)" : "rgba(57,255,176,.55)") : lightTheme ? "rgba(41,32,90,.34)" : "rgba(174,164,214,.3)";
        ctx.fillText(ate ? (ate === 1 ? "0" : "1") : String.fromCharCode(gch[g]!), gx[g]!, gy[g]!);
      }
      ctx.globalAlpha = 1;
    }
    for (const s of tiles) {
      if (!s.on) continue;
      const x = s.c * T + 3, y = s.r * T + 3, w = T - 6;
      const rolling = s.roll > 0, color = rolling ? COLORS[((now * 14) | 0) % 8]! : TILE_COLOR[s.type]!;
      const pulse = rolling ? 0.85 : 0.55 + 0.45 * Math.abs(Math.sin(now * (s.type === MINE ? 9 : 4)));
      ctx.globalAlpha = (embed || lightTheme || state !== "play" ? 0.7 : 0.35) * pulse;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, w);
      ctx.globalAlpha = !rolling && s.t < 2 && ((now * 6) | 0) % 2 ? 0.3 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, w);
      if (!rolling) tileIcon(s.type, x, y, w);
      ctx.globalAlpha = 1;
    }
    fx.drawGround(ctx, lightTheme);
    // Cover blocks (Blitz) and base walls (Sherman Bytes: amber, striped).
    for (const b of blocks) {
      if (b.hp <= 0) {
        if (b.site === -2) continue;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#aea4d6";
        ctx.fillRect(b.x, b.y + b.h / 2 - 2, b.w, 4);
        ctx.globalAlpha = 1;
        continue;
      }
      if (b.site >= 0) {
        ctx.fillStyle = "#07060f";
        ctx.fillRect(b.x, b.y + 4, b.w, b.h);
        ctx.fillStyle = lightTheme ? "#ffe6a8" : "#3a2a14";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = b.hp > 2 ? "#ffc21a" : b.hp > 1 ? "#ff8a1f" : "#ff2b4e";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = ctx.strokeStyle;
        const long = b.w > b.h, n = Math.floor((long ? b.w : b.h) / 16);
        for (let k = 1; k < n; k++) long ? ctx.fillRect(b.x + k * 16 - 2, b.y + 3, 4, b.h - 6) : ctx.fillRect(b.x + 3, b.y + k * 16 - 2, b.w - 6, 4);
        continue;
      }
      ctx.fillStyle = lightTheme ? "#f6f3ff" : "#1a1430";
      ctx.strokeStyle = b.hp === 3 ? "#ff8a1f" : b.hp === 2 ? "#ffc21a" : "#ff2b4e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(b.x + b.w / 2 - 6, b.y + b.h / 2 - 2, 12, 4);
    }
    for (const s of sites) if (s.on) buttonSite(s, now);
    // Byte Runner's pellets, sitting on the blocks: food for the flies and the frog.
    for (let p = 0; p < pellets; p++) {
      if (!pelOn[p]) continue;
      const g = 2.5 + Math.abs(Math.sin(now * 4 + p)) * 2;
      ctx.fillStyle = "#07060f";
      ctx.fillRect(pelX[p]! - 6, pelY[p]! - 6, 12, 12);
      ctx.fillStyle = "#a8ff3e";
      ctx.fillRect(pelX[p]! - 4 - g / 2, pelY[p]! - 4 - g / 2, 8 + g, 8 + g);
      ctx.fillStyle = "#fff5d7";
      ctx.fillRect(pelX[p]! - 3, pelY[p]! - 3, 6, 6);
    }
    for (const m of marks) {
      if (!m.on) continue;
      const k = m.t / m.max;
      reticle(m.x, m.y, (40 + 70 * k) * (scale / 1.4), now, 1 - k * 0.4);
    }
    for (const b of bombs) {
      if (!b.on) continue;
      const k = b.wait > 0 ? 0 : 1 - b.fall / 0.5;
      ctx.globalAlpha = 0.25 + 0.4 * k;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 4 + 10 * k, 2.5 + 6 * k, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < supply.count; i++) {
      const x = supply.x[i]!, y = supply.y[i]!, land = supply.landY[i]!, kind = supply.kind[i]!;
      if (!supply.landed(i)) {
        const drop = Math.min(1, supply.age[i]! / CRATE_DROP), k = 1 - drop;
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(x, land + 4, 14 * (0.5 + drop * 0.5), 7 * (0.5 + drop * 0.5), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        chute(x, y, scale * 0.8, "#ffc21a", Math.sin(now * 3) * 0.12 * k);
        crate(x, y, scale * 0.9, kind);
      } else if (supply.life - supply.age[i]! > 3 || ((now * 8) | 0) % 2) {
        ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(now * 4));
        ctx.strokeStyle = "#ffc21a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 22 * scale, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        crate(x, y, scale * 0.9, kind);
      }
    }
    // Ground foes: bugs (with tier pips) and enemy tanks.
    ctx.textAlign = "center";
    for (const f of foes) {
      if (!f.on) continue;
      if (f.kind === BUG) {
        const moving = f.vx * f.vx + f.vy * f.vy > 4;
        drawBug(ctx, f.x, f.y, f.a, f.tier, moving && !calm.matches ? ((now * 10 + f.sub) | 0) % 2 : 0, f.flash > 0, (1.05 + f.tier * 0.28) * (scale / 1.4) * (f.boss ? 1.8 : 1));
        if (f.boss) bossTag(f, 30 * scale);
        if (f.tier > 1) for (let k = 0; k < f.tier; k++) (ctx.fillStyle = k < f.hp ? (f.tier === 3 ? "#ff2b4e" : "#ff8a1f") : "rgba(255,255,255,.16)"), ctx.fillRect(f.x - (f.tier * 5 - 2) / 2 + k * 5, f.y + 16 * scale, 3, 3);
      } else if (f.kind === ETANK) {
        drawTank(ctx, f.x, f.y, f.a, f.ta, f.flash > 0 ? "#fff4ff" : f.boss ? "#ff2b4e" : ETANK_COLOR, f.tread, f.recoil, false, scale * (f.boss ? 1.35 : 0.95));
        if (f.boss) bossTag(f, 36 * scale);
        else bar(f.x, f.y - 26 * scale, 26, f.hp / f.max, ETANK_COLOR);
      } else if (f.kind === FROG) {
        // The frog: grows with every pellet. A big one's tongue tell: a dashed line to the spot, blinking.
        const size = 1 + Math.min(1.2, f.eaten * 0.15), left = f.a > 1.5, mx = f.x + (left ? -12 : 12) * size * scale * 0.9, my = f.y;
        if (f.mode === 1) {
          const blink = ((now * 10) | 0) % 2;
          ctx.strokeStyle = blink ? "#ff2b4e" : "#ff5c8f";
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(f.gx, f.gy);
          ctx.stroke();
          ctx.setLineDash([]);
          brackets(f.gx, f.gy, 34 * scale * (0.7 + 0.3 * (f.think / 0.9)), ctx.strokeStyle, 3);
        } else if (f.mode === 2) {
          ctx.strokeStyle = "#ff5c8f";
          ctx.lineWidth = 7 * size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(f.gx, f.gy);
          ctx.stroke();
          ctx.lineCap = "butt";
          ctx.fillStyle = "#ff2b4e";
          ctx.beginPath();
          ctx.arc(f.gx, f.gy, 6 * size, 0, TAU);
          ctx.fill();
        }
        drawFrog(ctx, f.x, f.y - (f.u > 0 ? Math.sin((f.u / 0.32) * Math.PI) * 10 : 0), left, f.mode ? 2 : f.eaten >= 4 ? 1 : 0, f.eaten >= 4, f.flash > 0, f.u > 0 ? 1 : 0, scale * 0.9 * size);
        if (f.boss) bossTag(f, 30 * size * scale);
        else bar(f.x, f.y - 24 * size * scale, 30, f.hp / f.max, "#3ecb74");
      }
    }
    // Your rides on the ground: the tank (and its parachute); the plane's shadow.
    for (const u of crew) {
      if (!u.alive) continue;
      const mineU = u.you;
      if (u.kind === PLANE) {
        // The plane flies: its shadow sits on the ground, offset; the plane is drawn with the air.
        const alt = u.drop < 1 ? (1 - u.drop) * 140 : 26;
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(u.x + alt * 0.5, u.y + alt, 16 * scale, 8 * scale, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      if (u.drop < 1) {
        const k = 1 - u.drop, lift = k * 150, sc = scale * (1 + k * 0.7);
        ctx.globalAlpha = 0.35 * (1 - k * 0.6);
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(u.x, u.y + 6, 20 * scale * (0.5 + u.drop * 0.5), 9 * scale * (0.5 + u.drop * 0.5), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        const y = u.y - lift, sway = Math.sin(now * 3 + u.i) * 0.12 * k;
        chute(u.x, y, sc, u.color, sway);
        drawTank(ctx, u.x, y, u.a + sway, u.ta + sway, u.color, u.tread, 0, false, sc);
        continue;
      }
      ring(u, mineU, now);
      drawTank(ctx, u.x, u.y, u.a, u.ta, u.color, u.tread, u.recoil, u.flash > 0, scale);
      unitExtras(u, now);
    }
    // Shells.
    ctx.lineCap = "round";
    for (const s of shells) {
      if (!s.on) continue;
      const c = s.foe ? (s.kind === K_ALIEN ? "#ff2e88" : s.kind === K_FLAK ? "#ffc21a" : ETANK_COLOR) : s.kind === K_RAIL ? "#ffc21a" : crew[s.owner]!.color;
      const tail = s.rail ? 0.06 : s.kind === K_ALIEN ? 0.05 : 0.035;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = s.rail ? 12 : s.kind === K_BOLT ? 6 : 8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * tail, s.y - s.vy * tail);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = s.rail ? 4 : s.kind === K_BOLT ? 2.5 : 3;
      ctx.strokeStyle = s.foe ? c : "#fff4ff";
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    for (const b of bombs) {
      if (!b.on || b.wait > 0) continue;
      const k = b.fall / 0.5, y = b.y - k * 70, s = (0.7 + 0.6 * k) * (scale / 1.4);
      ctx.fillStyle = "#1a1430";
      ctx.strokeStyle = "#f6f3ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(b.x, y, 5 * s, 9 * s, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff2e88";
      ctx.fillRect(b.x - 6 * s, y - 12 * s, 12 * s, 3 * s);
    }
    // The air: flies, aliens, then the plane.
    for (const f of foes) {
      if (!f.on) continue;
      if (f.kind === FLY) {
        drawFly(ctx, f.x, f.y, f.sub, ((now * 16 + f.sub * 3) | 0) % 2, f.flash > 0, f.flash > 0, scale * (1.1 + (f.tier - 1) * 0.3));
        if (f.tier > 1) pips(f, 14 * scale * (1 + (f.tier - 1) * 0.3), "#a8ff3e");
      }
      else if (f.kind === ALIEN) {
        drawAlien(ctx, f.x, f.y, f.sub, ((now * 3 + f.sub) | 0) % 2, f.flash > 0, scale * (f.boss ? 2.4 : 0.95));
        if (f.boss) bossTag(f, 40 * scale);
        else if (f.max > 1 && f.hp < f.max) bar(f.x, f.y - 20 * scale, 20, f.hp / f.max, "#f4457a");
      }
    }
    for (const u of crew) {
      if (!u.alive || u.kind !== PLANE) continue;
      const k = u.drop < 1 ? 1 - u.drop : 0, sc = scale * 0.95 * (1 + k * 0.6);
      if (!k) ring(u, u.you, now);
      drawShip(ctx, u.x, u.y - k * 140, u.ta, u.tier, ((now * 12) | 0) % 2, u.flash > 0, sc * 1.1);
      if (!k) unitExtras(u, now);
    }
    for (const u of crew) if (u.alive) tag(u);
    if (!demo) locatePulse();
    // Your aim: the lock (cyan brackets) or auto's pick (thin).
    if (!demo && you.alive && you.drop >= 1 && you.charge <= 0) {
      const k = lockOn ? lockT : autoOn ? pick(you, you.x, you.y, 520) : -1;
      if (where(k)) {
        const pulse = lockOn ? 2 * Math.sin(now * 6) : 0, x = F[QX]!, y = F[QY]!, r = k >= MAXF ? sites[k - MAXF]!.w / 2 + 6 : 24 + pulse;
        brackets(x, y, r * (scale / 1.4), lockOn ? "#19f0ff" : "rgba(25,240,255,.55)", lockOn ? 3 : 1.5);
        if (lockOn) {
          ctx.font = "800 9px ui-monospace,monospace";
          ctx.fillStyle = "#19f0ff";
          ctx.fillText("LOCK", x, y + 36 * (scale / 1.4));
        }
      }
    }
    fx.draw(ctx, lightTheme);
    for (const p of bombers) {
      if (!p.on) continue;
      const s = 1.5 * (scale / 1.4);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#000";
      jet(p.x + 20, p.y + 26, p.a, s * 0.8);
      ctx.fill();
      ctx.globalAlpha = 1;
      jet(p.x, p.y - 70, p.a, s);
      ctx.fillStyle = crew[p.owner]!.color;
      ctx.strokeStyle = "#07060f";
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
    }
    if (!demo && you.alive && you.drop >= 1 && you.kind === TANK && (you.heat > 0.05 || you.hot > 0)) {
      ctx.fillStyle = "rgba(7,6,15,.7)";
      ctx.fillRect(you.x - 18, you.y + 25 * scale, 36, 4);
      ctx.fillStyle = you.hot > 0 ? (((now * 8) | 0) % 2 ? "#ff2b4e" : "#ffc21a") : "#ffc21a";
      ctx.fillRect(you.x - 18, you.y + 25 * scale, 36 * (you.hot > 0 ? 1 : you.heat), 4);
    }
    if (targeting && (fine.matches || input.pointer.x || input.pointer.y)) {
      const x = wx(input.pointer.x), y = wy(input.pointer.y), r = (62 + 5 * Math.sin(now * 5)) * (scale / 1.4);
      reticle(x, y, r, now, 1);
      ctx.font = "900 12px ui-monospace,monospace";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#07060f";
      ctx.strokeText("AIRSTRIKE", x, y - r - 22);
      ctx.fillStyle = "#ff2e88";
      ctx.fillText("AIRSTRIKE", x, y - r - 22);
    } else if (!demo && you.alive && !input.stick.active && fine.matches && state === "play") {
      ctx.strokeStyle = you.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx(input.pointer.x), wy(input.pointer.y), 9, 0, TAU);
      ctx.stroke();
    }
  }
  /** Your ring (a marching dashed circle) or your partner's (thin), and a shield bubble. */
  function ring(u: Unit, mineU: boolean, now: number) {
    if (demo) return;
    const r = 27 * scale;
    if (mineU) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = u.color;
      ctx.beginPath();
      ctx.arc(u.x, u.y, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -now * 30;
      ctx.strokeStyle = "#07060f";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(u.x, u.y, r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = u.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = u.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 23 * scale, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function unitExtras(u: Unit, now: number) {
    if (u.shield > 0 && (u.shield > 1.5 || ((now * 10) | 0) % 2)) {
      ctx.strokeStyle = "#f6f3ff";
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 22 * scale, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (u.rapid > 0 || u.triple > 0) {
      ctx.fillStyle = u.triple > 0 ? "#19f0ff" : "#39ffb0";
      ctx.fillRect(u.x - 12, u.y + 20 * scale, (24 * Math.max(u.rapid, u.triple)) / 8, 3);
    }
    if (u.charge > 0 && where(u.chargeT)) {
      const k = u.charge / (u.kind === TANK ? 0.45 : 0.2), x = F[QX]!, y = F[QY]!;
      ctx.globalAlpha = 0.5 + 0.5 * (((now * 20) | 0) % 2);
      ctx.strokeStyle = u.you ? "#ffc21a" : "#ff2b4e";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      brackets(x, y, (18 + 26 * k) * (scale / 1.4), ctx.strokeStyle, 3);
    }
  }
  /** Name tag and health pips over a ride (YOU, or the partner's ride). */
  function tag(u: Unit) {
    const lift = u.drop < 1 ? (1 - u.drop) * (u.kind === PLANE ? 140 : 150) + (u.kind === TANK ? 70 * scale : 20) : 0;
    const ty = u.y - lift - 27 * scale - 6;
    ctx.save();
    upright(u.x, u.y);
    ctx.font = `800 ${u.you ? 12 : 10}px ui-monospace,monospace`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
    const t = demo ? u.name : u.you ? "▼ YOU" : u.human ? `▲ ${u.name}` : `▲ ${u.name} · AI`;
    ctx.strokeText(t, u.x, ty);
    ctx.fillStyle = u.color;
    ctx.fillText(t, u.x, ty);
    if (u.drop >= 1) {
      const m = MAXHP[u.kind]!;
      for (let k = 0; k < m; k++) (ctx.fillStyle = k < u.hp ? (u.hp <= 2 ? "#ff2b4e" : u.color) : "rgba(174,164,214,.3)"), ctx.fillRect(u.x - (m * 7) / 2 + k * 7, ty + 4, 5, 3);
    }    ctx.restore();
  }

  // ---------- Wiring: the round keys (Blitz) ----------
  const tapKey = (b: HTMLButtonElement, intent: string) => {
    const go = () => (input.press(intent), input.press(intent, false));
    b.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), b.disabled || go()), { signal: e.signal });
    b.addEventListener("click", (ev) => ev.detail === 0 && go(), { signal: e.signal });
  };
  tapKey(keys.auto, "auto");
  tapKey(keys.lock, "lock");
  tapKey(keys.strike, "strike");
  keys.long.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), (longQ = true)), { signal: e.signal });
  keys.long.addEventListener("click", (ev) => ev.detail === 0 && (longQ = true), { signal: e.signal });
  const fireUp = () => (keys.fire.classList.remove("down"), input.press("fire", false));
  keys.fire.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    keys.fire.setPointerCapture?.(ev.pointerId);
    keys.fire.classList.add("down");
    input.press("fire");
    fireQ = true;
  }, { signal: e.signal });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) keys.fire.addEventListener(t, fireUp, { signal: e.signal });
  const stk = $<HTMLElement>("[data-stk]"), knob = stk.firstElementChild as HTMLElement;
  const steer = (ev: PointerEvent) => {
    const r = stk.getBoundingClientRect(), Rr = r.width / 2;
    let x = (ev.clientX - r.left - Rr) / Rr, y = (ev.clientY - r.top - Rr) / Rr;
    const d = Math.max(1, Math.hypot(x, y));
    input.steer((x /= d), (y /= d));
    knob.style.translate = `${x * 40}px ${y * 40}px`;
  };
  stk.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), stk.setPointerCapture?.(ev.pointerId), steer(ev)), { signal: e.signal });
  stk.addEventListener("pointermove", (ev) => stk.hasPointerCapture?.(ev.pointerId) && steer(ev), { signal: e.signal });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) stk.addEventListener(t, () => (input.steer(0, 0, false), (knob.style.translate = "")), { signal: e.signal });
  const movable = (el: HTMLElement, handle: HTMLElement, id: string, clamp: (at: Float64Array, w: DOMRect) => void, css: (x: number, y: number) => string) => {
    const at = new Float64Array(4);
    const place = () => (clamp(at, wrap.getBoundingClientRect()), (el.style.translate = at[0] || at[1] ? css(at[0]!, at[1]!) : ""));
    try {
      const v = JSON.parse(localStorage.getItem(id) ?? "null");
      if (Array.isArray(v)) (at[0] = +v[0] || 0), (at[1] = +v[1] || 0), requestAnimationFrame(place);
    } catch {}
    const save = () => {
      try {
        localStorage.setItem(id, JSON.stringify([at[0], at[1]]));
      } catch {}
    };
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button) return;
      ev.stopPropagation();
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add("on");
      at[2] = ev.clientX - at[0]!;
      at[3] = ev.clientY - at[1]!;
    }, { signal: e.signal });
    handle.addEventListener("pointermove", (ev) => {
      if (!handle.classList.contains("on")) return;
      at[0] = ev.clientX - at[2]!;
      at[1] = ev.clientY - at[3]!;
      place();
    }, { signal: e.signal });
    for (const t of ["pointerup", "pointercancel"]) handle.addEventListener(t, () => handle.classList.contains("on") && (handle.classList.remove("on"), save()), { signal: e.signal });
    handle.addEventListener("dblclick", () => ((at[0] = at[1] = 0), place(), save()), { signal: e.signal });
  };
  const pad = $<HTMLElement>("[data-pad]");
  movable(pad, $<HTMLButtonElement>("[data-grab]"), "crossfire:pad", (at, r) => {
    const pw = pad.offsetWidth * 0.9, ph = pad.offsetHeight * 0.9;
    at[0] = Math.max(-(r.width - pw - 8), Math.min(8, at[0]!));
    at[1] = Math.max(-(r.height - ph - 8), Math.min(8, at[1]!));
  }, (x, y) => `${x}px ${y}px`);
  $<HTMLButtonElement>("[data-pause]").addEventListener("click", () => state === "play" && togglePause(), { signal: e.signal });
  const fsKey = $<HTMLButtonElement>("[data-fs]");
  const fsOn = () => document.fullscreenElement === host || wrap.classList.contains("full");
  const fsCan = document.fullscreenEnabled || "webkitRequestFullscreen" in document.documentElement;
  const fsHide = () => (fsKey.hidden = wrap.classList.toggle("nofs", !fsCan || phone.matches));
  fsHide();
  phone.addEventListener("change", fsHide, { signal: e.signal });
  const fsPaint = () => {
    const on = fsOn();
    fsKey.innerHTML = svg(on ? "exit" : "full");
    fsKey.setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
    fsKey.setAttribute("aria-pressed", String(on));
  };
  fsKey.addEventListener("click", async () => {
    if (fsOn()) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      wrap.classList.remove("full");
    } else if (host.requestFullscreen) {
      await host.requestFullscreen({ navigationUI: "hide" }).catch(() => wrap.classList.add("full"));
      (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {});
    } else wrap.classList.add("full");
    fsPaint();
  }, { signal: e.signal });
  document.addEventListener("fullscreenchange", fsPaint, { signal: e.signal });
  canvas.addEventListener("contextmenu", (ev) => (ev.preventDefault(), targeting ? (targeting = false) : (longQ = true)), { signal: e.signal });
  const theme = () => {
    lightTheme = document.documentElement.dataset.theme === "light";
    wrap.classList.toggle("light", lightTheme);
    wrap.dataset.theme = lightTheme ? "light" : "dark";
  };
  const mo = new MutationObserver(theme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  e.signal.addEventListener("abort", () => mo.disconnect());
  theme();
  new ResizeObserver(() => resize()).observe(wrap);
  resize();
  rideKeys();
  G[CRATE_IN] = 14;
  // The attract match plays the finale (all four armies on the board), again and again.
  if (embed || demo) (G[WAVE] = demo ? FINALE : 1), startWave();
  else if (net) countdown(); // every peer starts the countdown on frame 0
  else intro();
  e.start();

  return {
    engine: e,
    get state() {
      return state;
    },
    /** Squad play: the lockstep frame, stalls, the first desynced frame (-1) and who left; or null. */
    get net() {
      return link;
    },
    /** A hash of the match (squad play compares it across peers). */
    hash: worldHash,
    /** Start the match (from the start screen: the countdown, then wave 1). */
    start: () => (state === "intro" ? countdown() : undefined),
    get ride(): Ride {
      return you.kind === TANK ? "tank" : "plane";
    },
    /** Pick your ride on the start screen (the other one is your partner). */
    set ride(r: Ride) {
      if (state !== "intro") return;
      over.querySelector<HTMLButtonElement>(`[data-ride=${r}]`)?.click();
    },
    get score() {
      return Math.round(G[SCORE]!);
    },
    get wave() {
      return G[WAVE]!;
    },
    get drops() {
      return G[DROPS]!;
    },
    /** Seconds of match played (not the start screen, the countdown, a pause or a resume count). */
    get elapsed() {
      return G[PLAYED]!;
    },
    /** Debug / tests: the live world. */
    world: {
      get crew() {
        return crew.slice(0, CN);
      },
      foes, sites, shells, tiles, blocks, bombers, bombs, marks,
      get pellets() {
        return pellets;
      },
      /** Pellet i (Byte Runner's food, on a block): [x, y, on]. */
      pellet: (i: number) => [pelX[i]!, pelY[i]!, pelOn[i]!],
      /** Where the match is: section 1-4 (5 the finale) and the wave in it (1-4). */
      get section() {
        return section() + 1;
      },
      get step() {
        return step() + 1;
      },
      get glyphs() {
        return glyphs;
      },
      get eaten() {
        let n = 0;
        for (let g = 0; g < glyphs; g++) n += gate[g]! ? 1 : 0;
        return n;
      },
      get phase() {
        return G[PHASE]!;
      },
      /** Run `n` fixed steps (1/60 s) with no read or render: the zero-allocation test counts the step alone. */
      steps(n: number) {
        for (let k = 0; k < n; k++) world(1 / 60);
      },
      /** Beat the wave now (tests and screenshots): every foe gone, every site down, nothing left to come. */
      clear() {
        for (const f of foes) f.on = false;
        for (const st of sites) st.hp = 0;
        G[BUGS_LEFT] = G[FLIES_LEFT] = G[FROGS_LEFT] = 0;
      },
      /** Skip to wave `w` (tests and screenshots): clears the board and starts it. */
      wave(w: number) {
        for (const f of foes) f.on = false;
        for (const s of shells) s.on = false;
        G[WAVE] = w;
        startWave();
      },
      get crates() {
        return Array.from({ length: supply.count }, (_, i) => ({ x: supply.x[i]!, y: supply.y[i]!, kind: supply.kind[i]!, landed: supply.landed(i) }));
      },
    },
    get shake() {
      return shook;
    },
    controls: {
      get auto() {
        return autoOn;
      },
      get lock() {
        return lockOn;
      },
      get targeting() {
        return targeting;
      },
      get locate() {
        return locateAt;
      },
      crate: () => dropCrate(),
    },
    get sound() {
      return sfx.on;
    },
    set sound(v: boolean) {
      sfx.on = v;
    },
    destroy() {
      for (const a of anims) a.cancel();
      anims.clear();
      e.destroy();
      wrap.remove();
      style.remove();
    },
  };
}
export type Crossfire = ReturnType<typeof createCrossfire>;
