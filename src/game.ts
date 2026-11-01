// DOM Crossfire on fizlet/arcade: the shell (the page is the board, a full-screen overlay, keys and
// touch pad, sound, the touch lock, Recall gives the page back exactly) with the HUD preset this
// game's type picks (./type: skirmish, the bar with its match flow: countdown, pause / surrender,
// result; the bar drags). This file only wires the shell to the simulation (./sim, ./rules):
// inputs become bits in the read phase, the sim steps on the fixed step, render draws and reacts.
import { arcade, skirmishHud, KX, KY, FIRE as FIRE_ON, MODE, PX, PY, PON, type ArcadeController, type ArcadeOptions } from "../vendor/fizlet/arcade";
import type { Engine } from "../vendor/fizlet/kernel/engine";
import type { FizEvent } from "../vendor/fizlet/kernel/ring";
import { ACTIONS, FIRE, HUD, NET_HUD, PAD } from "./type";
import { ROLE } from "./look";
import { rules, ACCENT, NAMES, RULE, GLITCH_S, CARTS, T } from "./rules";
import { create, reset, step } from "./sim";
import { encode, OVER, WW, WH, X, Y, SEAT, CART, CT, GLITCH, CH, ORDER, type World } from "./world";

declare const __KIT_CSS__: string;

/** The round's numbers (the rules' `stats`): the result card lists the type's and keeps the best score; `player` (world units) is for tools and audits. */
export type Stats = Record<string, number | { x: number; y: number; angle: number }>;
/** How a networked match plugs in (src/net.ts): the seat, and a hook that drives the steps. */
export interface Net {
  slot: number;
  players: number;
  seed: number;
  /** Called once per run with the run's engine: run `step` for every confirmed frame. */
  wire(e: Engine, input: () => number, step: (e: Engine, inputs: Uint32Array) => void, hash: () => number): void;
}
export interface Options extends Omit<ArcadeOptions<Stats>, "seed"> {
  /** Same seed, same match (default: a new one each run). */
  seed?: number;
  /** Lockstep play (src/net.ts sets it). */
  net?: Net;
}

const CUES = { fire: "fire", hit: "hit", hurt: "hurt", wave: "power", glitch: "boom", channel: "ready", eat: "click", power: "power", flag: "power", dud: "click", shell: "click" } as const;
/** Channel numbers as text, made once (render never builds a string per frame). */
const CHN = ["CH 01", "CH 02", "CH 03", "CH 04", "CH 05"];
/** The guide strip under the arena: every cartridge's channel number and short name. */
const GUIDE = ["1 NULL", "2 BYTE", "3 SHERMAN", "4 SWARM", "5 FIELD"];

export function createDomCrossfire(o: Options = {}) {
  const me = o.net?.slot ?? 0;
  let w: World | null = null;
  // view: scale, x offset, y offset (world → viewport); quake: screen shake in px. Render only.
  const view = new Float64Array(3), quake = new Float64Array(1), lay = new Float64Array(10);
  const ctl: ArcadeController<Stats> = arcade<Stats>({
    id: "dom-crossfire",
    title: "DOM Crossfire",
    color: ROLE.teamA,
    hint: "Every 30 seconds the virus changes the channel: same stick, new rules. Survive all five. P pauses, Esc gives the page back.",
    touchHint: "Every 30 seconds the virus changes the channel: same stick, new rules. Survive all five.",
    css: __KIT_CSS__,
    fire: FIRE,
    actions: ACTIONS,
    pad: PAD,
    keyboard: false, // the mouse steers too (the shell flips to keys when an arrow is pressed)
    colors: [ROLE.flag, ROLE.hurt, ROLE.teamB],
    cues: CUES,
    paint: false,
    // The Board UI banner on every channel change: the cartridge's name and the one rule that changed.
    hud: skirmishHud({ ...(o.net ? NET_HUD : HUD), banner: { on: "channel", text: (a: number) => [NAMES[a]!, `${CHN[a]} · ${RULE[a]}`] as const } }),
    create(ctx) {
      // Solo is one seat; a networked match has the room's seats (PLAYERS is what the room card asks for).
      const world = (w = create(ctx.engine, o.net?.players ?? 1));
      const c = ctx.ctl, input = ctx.input, act = ACTIONS.length ? input.id("act") : -1;
      // Keys and the pad give a stick; the mouse steers too: the hero heads for the pointer (a stick
      // from the pointer's offset in world units, full at 64), so the desktop plays with one hand.
      const mine = () => {
        let x = c[KX]!, y = c[KY]!;
        if (c[MODE] === 1 && c[PON] && view[0]! > 0) {
          const k = me * SEAT, dx = ((c[PX]! - view[1]!) / view[0]! - world.s[k + X]!) / 64, dy = ((c[PY]! - view[2]!) / view[0]! - world.s[k + Y]!) / 64;
          const m = Math.sqrt(dx * dx + dy * dy);
          (x = m < 0.15 ? 0 : m > 1 ? dx / m : dx), (y = m < 0.15 ? 0 : m > 1 ? dy / m : dy);
        }
        return encode(x, y, c[FIRE_ON]! > 0, act >= 0 && input.down(act));
      };
      // The page makes room: the HUD's height on top (padding), and the arena with its channel bar
      // in a block of its own after the page's title (a phone's block runs to the screen's bottom,
      // so the pad sits on it, not on the copy). Through the ledger: Recall takes both back, and
      // the page scrolls back to where it was.
      const doc = document, body = doc.body, e = ctx.engine, sr = e.root!.shadowRoot!, ban = sr.querySelector<HTMLElement>(".sk-ban")!, h1 = body.querySelector("h1");
      const slot = e.ledger.add(doc.createElement("div")), y0 = scrollY, top = sr.querySelector(".sk")!.getBoundingClientRect().bottom + 12;
      h1 ? h1.after(slot) : body.prepend(slot);
      e.ledger.style(doc.documentElement, "padding-top", top + "px");
      e.signal.addEventListener("abort", () => queueMicrotask(() => scrollTo(0, y0))); // after the ledger's restore
      // lay: the viewport's w, h; the slot's page top; its height to set (0: set); the scale; -;
      // scrollY; the banner's y. Measured in read, written in render.
      const fit = () => {
        const vw = innerWidth, vh = innerHeight, r = slot.getBoundingClientRect(), pad = sr.querySelector(".bui-pad")?.getBoundingClientRect();
        const room = vh - top - (h1 ? r.top - h1.getBoundingClientRect().top : 0), foot = pad ? vh - pad.top + 8 : 16;
        const k = Math.min((vw - 20) / (WW + 20), Math.max((room - foot) / (WH + 52), 0.35), 1.6), h = (WH + 52) * k;
        (lay[0] = vw), (lay[1] = vh), (lay[2] = r.top + scrollY), (lay[4] = k);
        lay[3] = pad ? Math.max(h + 16, room) : h + 16;
      };
      // Render: the slot's height when it changed, the arena's place (view) and the channel banner
      // inside the arena, never on the page's copy.
      const place = () => {
        const k = lay[4]!;
        lay[3] && ((slot.style.height = lay[3] + "px"), (lay[3] = 0));
        (view[0] = k), (view[1] = (lay[0]! - WW * k) / 2), (view[2] = lay[2]! - lay[6]! + 10 * k);
        const y = Math.round(view[2]! + WH * k * 0.1);
        if (y !== lay[7]) ban.style.top = (lay[7] = y) + "px";
      };
      fit(), place();
      scrollTo(0, (h1 ?? slot).getBoundingClientRect().top + scrollY - top);
      (lay[6] = scrollY), place(); // for the countdown: the banner is up before the first frame
      e.add({ read: () => ((lay[6] = scrollY), (lay[0] !== innerWidth || lay[1] !== innerHeight) && fit()) });
      if (o.net) o.net.wire(ctx.engine, mine, (e, inputs) => step(world, inputs, e.dt), () => hashOf(world));
      else {
        const inputs = new Uint32Array(1);
        ctx.engine.add({ step: (_e, dt) => ((inputs[0] = mine()), step(world, inputs, dt)) });
      }
      return {
        reset: () => ((quake[0] = 0), reset(world)),
        over: () => world.g[OVER]!,
        react(ev: FizEvent) {
          const x = view[1]! + ev.x * view[0]!, y = view[2]! + ev.y * view[0]!, calm = ctx.reduced();
          if (ev.type === "hit" && ev.a === me) {
            if (ev.b > 0) ctx.popup(x, y, ev.b, null, 0);
            ctx.spark(x, y, ev.b > 0 ? 14 : 8, 0), ctx.spark(x, y, 6, 1);
          } else if (ev.type === "dent") ctx.spark(x, y, 5, 2);
          else if (ev.type === "hurt" && ev.a === me) {
            ctx.popup(view[1]! + world.s[me * SEAT + X]! * view[0]!, view[2]! + world.s[me * SEAT + Y]! * view[0]!, 0, "ARMOR", 2);
            if (!calm) quake[0] = 8;
          } else if (ev.type === "glitch" && !calm) quake[0] = 12;
          else if (ev.type === "dud" && ev.a === me) ctx.say("This cartridge has no fire button. Eat the bytes, dodge the flies.", 2200);
        },
        draw(g: CanvasRenderingContext2D, dt: number) {
          // The world, fitted into the page's arena block (fit, in read) and centred (every screen
          // plays the same match), on a CRT: a dark screen in a Board UI bezel, so it reads the same
          // on light and dark pages.
          const calm = ctx.reduced(), time = ctx.engine.time, wg = world.g, cart = wg[CART]! | 0;
          place();
          const k = view[0]!;
          const shake = calm ? 0 : quake[0]!;
          quake[0] = Math.max(0, shake - dt * 40);
          g.save();
          g.translate(view[1]! + (shake ? (Math.random() - 0.5) * shake : 0), view[2]! + (shake ? (Math.random() - 0.5) * shake : 0));
          g.scale(k, k);
          // Bezel (the kit's vertical shadow), screen, and this channel's backdrop.
          g.fillStyle = ROLE.rim;
          g.fillRect(-10, -4, WW + 20, WH + 20);
          g.fillStyle = ROLE.line;
          g.fillRect(-10, -10, WW + 20, WH + 20);
          g.fillStyle = ROLE.bg;
          g.fillRect(0, 0, WW, WH);
          g.save();
          g.beginPath();
          g.rect(0, 0, WW, WH);
          g.clip();
          backdrop(g, cart, time, calm);
          rules.draw(world, g, time, calm);
          // Scanlines: the CRT.
          g.fillStyle = "rgba(0,0,0,0.18)";
          for (let y = 0; y < WH; y += 4) g.fillRect(0, y, WW, 2);
          const gl = wg[GLITCH]!;
          if (gl > 0) glitch(g, gl / GLITCH_S, wg[ORDER + (wg[CH]! | 0) + 1]! | 0, calm);
          else if (wg[CT]! < 3.2) osd(g, cart, wg[CT]!);
          g.restore();
          // The channel guide under the screen (where there is room for it to be read).
          if (k > 0.75) guide(g, cart);
          g.restore();
        },
        hud: (out: Float64Array) => rules.hud(world, out, me),
        stats: (): Stats => rules.stats(world),
      };
    },
  }, { ...o, seed: o.net?.seed ?? o.seed });
  return {
    ...ctl,
    /** End the round now (won or lost): the result card, then REMATCH / EXIT. Solo only. */
    finish(won: boolean) {
      if (w && !o.net) w.g[OVER] = won ? 2 : 1;
    },
    /** The arena's place on screen: scale, x, y of the world's origin (tests and tools). */
    view,
    /** The live world (read-only by convention): tests and tools. */
    get world() {
      return w;
    },
  };
}

// ---------- The console: backdrops, the OSD, the guide and the glitch (render only) ----------
const GRAYS = ["#000", "#333", "#666", "#999", "#ccc", "#fff"];
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** Each cartridge's floor, faint: stars, food lanes, dirt, a hive grid, the battle grid. */
function backdrop(g: CanvasRenderingContext2D, cart: number, time: number, calm: boolean) {
  g.fillStyle = ACCENT[cart]!;
  g.globalAlpha = 0.16;
  if (cart === 0) for (let i = 0; i < 70; i++) g.fillRect((i * 97) % WW, (i * 61 + (calm ? 0 : time * (20 + (i % 3) * 25))) % WH, 2, 2);
  else if (cart === 1) for (let r = 0; r < 6; r++) g.fillRect(60, 88 + r * 80, WW - 120, 4);
  else if (cart === 2) for (let y = 0; y < WH; y += 64) for (let x = (y / 64) % 2 ? 32 : 0; x < WW; x += 64) g.fillRect(x, y, 32, 32);
  else if (cart === 3) for (let y = 24; y < WH; y += 48) for (let x = (y / 48) % 2 ? 24 : 0; x < WW; x += 48) g.fillRect(x, y, 4, 4);
  else {
    for (let x = T; x < WW; x += T) g.fillRect(x - 1, 0, 2, WH);
    for (let y = T; y < WH; y += T) g.fillRect(0, y - 1, WW, 2);
  }
  g.globalAlpha = 1;
}
/** The on-screen display after a channel lands: the number and the name, like a TV. */
function osd(g: CanvasRenderingContext2D, cart: number, t: number) {
  g.globalAlpha = t > 2.6 ? (3.2 - t) / 0.6 : 1;
  g.textAlign = "left";
  g.font = `900 34px ${MONO}`;
  g.fillStyle = ACCENT[cart]!;
  g.fillText(CHN[cart]!, 22, 50);
  g.font = `800 15px ${MONO}`;
  g.fillStyle = ROLE.flag;
  g.fillText(NAMES[cart]!, 24, 74);
  g.globalAlpha = 1;
}
/** The guide strip: the five channels, the one on air lit. */
function guide(g: CanvasRenderingContext2D, cart: number) {
  const w = WW / CARTS;
  g.font = `800 13px ${MONO}`;
  g.textAlign = "center";
  for (let i = 0; i < CARTS; i++) {
    g.fillStyle = i === cart ? ACCENT[i]! : ROLE.raised;
    g.fillRect(i * w + 3, WH + 18, w - 6, 24);
    g.fillStyle = i === cart ? ROLE.rim : ROLE.muted;
    g.fillText(GUIDE[i]!, i * w + w / 2, WH + 35);
  }
}
/** The star: the console glitches. `f` runs 1 → 0 over the glitch; `next` is the cartridge coming.
 *  Tear (bands of the screen slip sideways), static, colour bars and a channel number that surfs
 *  before it lands. Reduced motion: a still card with the coming channel, no flicker, no tear. */
function glitch(g: CanvasRenderingContext2D, f: number, next: number, calm: boolean) {
  if (calm) {
    g.fillStyle = ROLE.bg;
    g.fillRect(0, 0, WW, WH);
    return card(g, next, 1);
  }
  const cv = g.canvas, m = g.getTransform();
  // Tear: copy bands of what is on screen, shifted (device pixels, the identity transform).
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const x0 = m.e, y0 = m.f, sw = WW * m.a, sh = WH * m.d;
  for (let i = 0; i < 9; i++) {
    const y = y0 + Math.random() * sh, h = 4 + Math.random() * 40 * m.d, dx = (Math.random() - 0.5) * 140 * f * m.a;
    g.drawImage(cv, x0, y, sw, h, x0 + dx, y, sw, h);
  }
  g.restore();
  // Colour bars at the start, static throughout, a rolling bright band.
  const bars = [ROLE.flag, ROLE.hurt, ROLE.sys, ROLE.go, ROLE.attack, ROLE.fire, ROLE.cmd];
  if (f > 0.55) {
    g.globalAlpha = (f - 0.55) * 1.6;
    for (let i = 0; i < 7; i++) (g.fillStyle = bars[i]!), g.fillRect((i * WW) / 7, 0, WW / 7 + 1, WH);
  }
  g.globalAlpha = 0.55;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = GRAYS[(Math.random() * 6) | 0]!;
    g.fillRect(Math.random() * WW, Math.random() * WH, 2 + Math.random() * 6, 2);
  }
  g.globalAlpha = 0.25;
  g.fillStyle = ROLE.flag;
  g.fillRect(0, ((1 - f) * 1.4 * WH) % WH, WW, 26);
  g.globalAlpha = 1;
  // Surfing: the number flips through channels, then lands on the one coming.
  card(g, f > 0.35 ? (Math.random() * CARTS) | 0 : next, f > 0.35 ? 0.85 : 1);
}
function card(g: CanvasRenderingContext2D, ch: number, a: number) {
  g.globalAlpha = a;
  g.textAlign = "center";
  g.font = `900 96px ${MONO}`;
  g.lineWidth = 10;
  g.strokeStyle = ROLE.rim;
  g.strokeText(CHN[ch]!, WW / 2, WH / 2 + 10);
  g.fillStyle = ACCENT[ch]!;
  g.fillText(CHN[ch]!, WW / 2, WH / 2 + 10);
  g.font = `900 22px ${MONO}`;
  g.strokeText(NAMES[ch]!, WW / 2, WH / 2 + 52);
  g.fillStyle = ROLE.flag;
  g.fillText(NAMES[ch]!, WW / 2, WH / 2 + 52);
  g.globalAlpha = 1;
}

/** FNV-1a over the world's bytes (fizlet/presence compares it across peers). */
export function hashOf(w: World) {
  let h = 0x811c9dc5;
  const b = w.bytes;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619);
  return h >>> 0;
}

export type Game = ReturnType<typeof createDomCrossfire>;
