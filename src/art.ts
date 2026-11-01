/**
 * DOM Crossfire's cast, drawn as data and baked once into tiny canvases (no images, no sprite DOM).
 * Every character comes from one of the owner's own DOM VIRUS games (MIT, Chris Cooley):
 *   the tank           Battlefield Blitz / Sherman Bytes: the M4-inspired pixel tank
 *   the plane          Null Invaders: the interceptor (its tiers: Pulse, Twin, Trident, Overdrive)
 *   aliens             Null Invaders: drone, crab and squid
 *   flies              Byte Runner: violet, pink and cyan flies (blue when they can be eaten)
 *   bugs               Swarm Protocol: a letter-eating bug that grows (drawn here in pixels)
 */

type Ctx = CanvasRenderingContext2D;

/** The tank: an original M4-inspired silhouette, two cached tread frames, the turret drawn on top
 *  (Battlefield Blitz's sprite, from Sherman Bytes 0.5.2). */
export function tankSprites(doc: Document) {
  const cache = new Map<string, HTMLCanvasElement[]>();
  return (ctx: Ctx, x: number, y: number, body: number, turret: number, color: string, tread: number, recoil: number, flash: boolean, scale = 1) => {
    let frames = cache.get(color);
    if (!frames) {
      frames = [0, 1].map((frame) => {
        const tile = doc.createElement("canvas");
        tile.width = 32;
        tile.height = 32;
        const c = tile.getContext("2d")!;
        c.fillStyle = "#151020";
        c.fillRect(3, 5, 26, 7);
        c.fillRect(3, 21, 26, 7);
        c.fillStyle = "#8573ee";
        for (let i = 0; i < 6; i++) {
          c.fillRect(4 + i * 4 + frame, 6, 2, 5);
          c.fillRect(4 + i * 4 + frame, 22, 2, 5);
        }
        c.fillStyle = color;
        c.fillRect(5, 11, 22, 11);
        c.fillRect(9, 9, 13, 15);
        c.fillRect(25, 13, 4, 7);
        c.fillStyle = "#241a35";
        c.fillRect(7, 12, 4, 9);
        c.fillRect(13, 13, 4, 7);
        c.fillStyle = "#06c4ff";
        c.fillRect(20, 14, 2, 5);
        c.fillRect(18, 16, 6, 1);
        return tile;
      });
      cache.set(color, frames);
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.rotate(body);
    ctx.drawImage(frames[Math.floor(tread) % 2]!, -16, -16);
    ctx.rotate(turret - body);
    ctx.fillStyle = flash ? "#fff8d4" : color;
    ctx.fillRect(-7, -6, 14, 12);
    ctx.fillRect(-5, -8, 10, 16);
    ctx.fillRect(4 - recoil, -2, 19, 4);
    ctx.fillStyle = "#241a35";
    ctx.fillRect(-4, -4, 5, 8);
    ctx.fillRect(20 - recoil, -2, 3, 4);
    if (recoil > 1) {
      ctx.fillStyle = "#cdde00";
      ctx.fillRect(26 - recoil, -3, 5, 6);
    }
    ctx.restore();
  };
}

// ---------- The interceptor (Null Invaders' ship art, nose up) ----------
const SHIP_PALETTE = ["", "#092331", "#06c4ff", "#0b8eae", "#cdde00", "#fff5d7"];
const SPANS: [number, number][][] = [
  [[13, 14], [17, 18]], [[12, 14], [17, 19]], [[12, 14], [17, 19]], [[11, 14], [17, 20]], [[11, 14], [17, 20]], [[11, 14], [17, 20]],
  [[10, 14], [17, 21]], [[10, 14], [17, 21]], [[9, 14], [17, 22]], [[9, 14], [17, 22]], [[8, 23]], [[7, 24]], [[6, 25]], [[5, 26]],
  [[4, 27]], [[3, 28]], [[2, 29]], [[1, 30]], [[1, 30]], [[1, 8], [9, 15], [16, 22], [23, 30]], [[1, 6], [10, 15], [16, 21], [25, 30]],
  [[1, 4], [11, 15], [16, 20], [27, 30]], [[1, 3], [12, 15], [16, 19], [28, 30]], [[12, 15], [16, 19]], [[12, 14], [17, 19]],
];
/** The ship's pixels at a weapon tier (1 Pulse, 2 Twin, 3 Trident, 4 Overdrive), engines lit or not. */
function shipPixels(tier: number, thrust: number) {
  const px = new Map<number, number>();
  const put = (x: number, y: number, c: number) => px.set(y * 64 + x + 8, c);
  const rect = (x: number, y: number, w: number, h: number, c: number, inside = false) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!inside || px.has(yy * 64 + xx + 8)) put(xx, yy, c);
  };
  SPANS.forEach((row, y) => row.forEach(([a, b]) => { for (let x = a; x < b; x++) put(x, y, 2); }));
  rect(12, 9, 7, 9, 1), rect(13, 17, 5, 2, 1), rect(11, 10, 1, 9, 3, true), rect(19, 10, 1, 9, 3, true);
  rect(14, 11, 3, 3, 4), put(15, 14, 4), rect(13, 19, 5, 2, 2);
  for (let y = 14; y <= 21; y++) {
    const x = Math.max(3, 9 - Math.floor((y - 14) / 2));
    rect(x, y, 2, 1, 3, true), rect(29 - x, y, 2, 1, 3, true);
  }
  rect(12, 22, 1, 3, 3, true), rect(18, 22, 1, 3, 3, true);
  if (tier >= 2) rect(8, 13, 2, 5, 3), rect(21, 13, 2, 5, 3), put(9, 13, 5), put(21, 13, 5);
  if (tier >= 3) rect(5, 12, 2, 7, 3), rect(24, 12, 2, 7, 3), rect(5, 12, 1, 4, 2), rect(25, 12, 1, 4, 2), put(5, 11, 5), put(25, 11, 5), rect(15, 7, 1, 3, 2);
  if (tier >= 4)
    for (const x of [-1, 28]) rect(x, 11, 4, 11, 3), rect(x + 1, 10, 2, 14, 2), rect(x + 1, 13, 2, 8, 2), rect(x, 12, 3, 1, 3), rect(x + 1, 8, 1, 2, 5);
  for (const x of [12, 18]) for (let y = 26; y < 26 + (thrust ? 4 : 1); y++) put(x, y, 5);
  return px;
}
/** The plane, baked per tier, engine frame and hit flash; drawn nose along `a` (radians, 0 = +x). */
export function shipSprites(doc: Document) {
  const cache = new Map<number, HTMLCanvasElement>();
  return (ctx: Ctx, x: number, y: number, a: number, tier: number, thrust: number, flash: boolean, scale = 1) => {
    const key = tier * 4 + thrust * 2 + +flash;
    let tile = cache.get(key);
    if (!tile) {
      tile = doc.createElement("canvas");
      tile.width = 38;
      tile.height = 36;
      const c = tile.getContext("2d")!;
      const px = shipPixels(tier, thrust);
      // One dark rim reads on light and dark boards (Null Invaders' choice).
      c.fillStyle = "#092331";
      for (const k of px.keys()) c.fillRect(((k % 64) - 8) + 2, ((k / 64) | 0) + 1, 3, 3);
      for (const [k, col] of px) (c.fillStyle = flash ? "#ffffff" : SHIP_PALETTE[col]!), c.fillRect(((k % 64) - 8) + 3, ((k / 64) | 0) + 2, 1, 1);
      cache.set(key, tile);
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(a + Math.PI / 2);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, -18, -16);
    ctx.restore();
  };
}

// ---------- Aliens (Null Invaders): drone, crab, squid ----------
const ALIENS = [
  ["..1.....1..", "...1...1...", "..1222221..", ".122222221.", "12232223221", "12212221221", "..1222221..", ".12.111.21.", ".1.......1."],
  ["..11...11..", ".1221.1221.", "12222222221", "12332223321", "12222222221", ".122222221.", "11211111211", "12.1...1.21", "1..1...1..1"],
  ["....111....", "...12221...", "..1222221..", ".122222221.", "12332223321", "12212221221", "..1222221..", ".121.1.121.", ".1.1.1.1.1."],
];
const ALIEN_PAL = [["", "#261634", "#8573ee", "#fff1ff"], ["", "#321623", "#f4457a", "#fff6d6"], ["", "#32200f", "#cdde00", "#fff7d1"]];
export function alienSprites(doc: Document) {
  const cache = new Map<number, HTMLCanvasElement>();
  return (ctx: Ctx, x: number, y: number, kind: number, frame: number, flash: boolean, scale = 1) => {
    const key = kind * 4 + frame * 2 + +flash;
    let tile = cache.get(key);
    if (!tile) {
      tile = doc.createElement("canvas");
      tile.width = 15;
      tile.height = 13;
      const c = tile.getContext("2d")!, rows = ALIENS[kind]!;
      for (const rim of [true, false])
        for (let r = 0; r < rows.length; r++)
          for (let k = 0; k < rows[r]!.length; k++) {
            const v = Number(rows[r]![k]);
            if (!v) continue;
            const shift = frame && r >= rows.length - 2 ? (k < 5 ? -1 : 1) : 0;
            c.fillStyle = rim ? "#eaf8ff" : flash ? "#ffffff" : ALIEN_PAL[kind]![v]!;
            c.fillRect(k + 2 + shift - (rim ? 1 : 0), r + 2 - (rim ? 1 : 0), rim ? 3 : 1, rim ? 3 : 1);
          }
      cache.set(key, tile);
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, -15, -13, 30, 26);
    ctx.restore();
  };
}

// ---------- Flies (Byte Runner): the same pixel paths, two wing frames ----------
const FLY_BODY = "M9 5h8v1h3v2h2v9h-1v2h-3v1h-2v-2h-3v2h-3v-2H7v-2H6v-5h1V8h2Z";
const FLY_EYES = "M10 8h4v6h-4V13H9V9h1ZM17 8h4v1h1v5h-5Z";
const FLY_PUPILS = "M12 9h2v4h-2ZM20 9h2v4h-2Z";
const FLY_WINGS = ["M2 0h2v2h2v2h1v5H5V7H3V5H1V2h1ZM21 1h2v2h1v2h1v4h-3V6h-2V3h1Z", "M0 7h3v1h2v2h2v3H4v-1H2v-1H0ZM23 7h2v1h2v3h-2v1h-3v1h-2v-3h1V9h2Z"];
const FLY_FEET = "M9 18h3v3H9Zm7 0h3v3h-3Z";
export const FLY_COLORS = ["#8573ee", "#f4457a", "#06c4ff"];
export function flySprites(doc: Document) {
  const cache = new Map<number, HTMLCanvasElement>();
  return (ctx: Ctx, x: number, y: number, kind: number, frame: number, blue: boolean, blink: boolean, scale = 1) => {
    const key = kind * 8 + frame * 4 + +blue * 2 + +blink;
    let tile = cache.get(key);
    if (!tile) {
      tile = doc.createElement("canvas");
      tile.width = 30;
      tile.height = 28;
      const c = tile.getContext("2d")!;
      c.translate(1, 2);
      const fill = (d: string, col: string) => ((c.fillStyle = col), c.fill(new Path2D(d)));
      fill(FLY_WINGS[frame]!, "#d9f0f3");
      fill(FLY_FEET, "#273148");
      fill(FLY_BODY, blue ? (blink ? "#f6f3ff" : "#628dce") : FLY_COLORS[kind % 3]!);
      fill(FLY_EYES, "#fff5d7");
      fill(FLY_PUPILS, "#152820");
      cache.set(key, tile);
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, -15, -14);
    ctx.restore();
  };
}

// ---------- Bugs (Swarm Protocol): a round-shelled bug, six legs that scuttle, three tiers ----------
// 1 leg or antenna, 2 the dark rim and the shell's seam, 3 the shell, 4 its highlight.
const BUG = ["..1......1..", "...1....1...", "....2222....", "...233332...", "..23444432..", "..23422432..", "..23422432..", "..23422432..", "..23422432..", "..23344332..", "...233332...", "....2222...."];
const BUG_LEGS = [["11........11", ".1........1.", "11........11"], [".1........1.", "11........11", ".1........1."]];
/** Tier colours: a fresh bug, a grown one (6 letters), a button hunter (12). */
export const BUG_COLORS = ["#b48cff", "#ff8a1f", "#ff2b4e"];
const BUG_LIGHT = ["#e6d9ff", "#ffcf9e", "#ff9fb0"];
export function bugSprites(doc: Document) {
  const cache = new Map<number, HTMLCanvasElement>();
  return (ctx: Ctx, x: number, y: number, a: number, tier: number, frame: number, flash: boolean, scale = 1) => {
    const key = tier * 4 + frame * 2 + +flash;
    let tile = cache.get(key);
    if (!tile) {
      tile = doc.createElement("canvas");
      tile.width = 12;
      tile.height = 12;
      const c = tile.getContext("2d")!, col = flash ? "#ffffff" : BUG_COLORS[tier - 1]!, hi = flash ? "#ffffff" : BUG_LIGHT[tier - 1]!;
      const put = (k: number, r: number, v: string) => v !== "." && ((c.fillStyle = v === "2" ? "#07060f" : v === "4" ? hi : col), c.fillRect(k, r, 1, 1));
      BUG.forEach((row, r) => [...row].forEach((v, k) => put(k, r, v)));
      BUG_LEGS[frame]!.forEach((row, r) => [...row].forEach((v, k) => put(k, 5 + r * 2, v)));
      cache.set(key, tile);
    }
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(a + Math.PI / 2);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, -12, -12, 24, 24);
    ctx.restore();
  };
}

// ---------- SVG previews for the start screen and the landing (same pixels, as rects) ----------
const rects = (cells: Iterable<[number, number, string]>) => {
  let s = "";
  for (const [x, y, c] of cells) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
  return s;
};
/** The interceptor as an SVG (Overdrive, engines lit). */
export function shipSvg(tier = 4) {
  const px = shipPixels(tier, 1), out: [number, number, string][] = [];
  for (const [k, c] of px) out.push([(k % 64) - 8 + 2, ((k / 64) | 0) + 1, SHIP_PALETTE[c]!]);
  return `<svg viewBox="0 0 36 34" aria-hidden="true" shape-rendering="crispEdges">${rects(out)}</svg>`;
}
/** The tank as an SVG (hull and turret facing up). */
export function tankSvg(color: string) {
  const r = (x: number, y: number, w: number, h: number, c: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  let s = r(5, 3, 7, 26, "#151020") + r(21, 3, 7, 26, "#151020");
  for (let i = 0; i < 6; i++) s += r(6, 4 + i * 4, 5, 2, "#8573ee") + r(22, 4 + i * 4, 5, 2, "#8573ee");
  s += r(11, 5, 11, 22, color) + r(9, 10, 15, 13, color) + r(12, 13, 9, 4, "#241a35");
  s += r(12, 10, 9, 12, color) + r(10, 12, 13, 8, color) + r(15, 0, 3, 13, color) + r(14, 14, 5, 5, "#241a35") + r(15, 0, 3, 2, "#241a35");
  return `<svg viewBox="0 0 33 32" aria-hidden="true" shape-rendering="crispEdges">${s}</svg>`;
}
/** An alien (0 drone, 1 crab, 2 squid) as an SVG. */
export function alienSvg(kind: number) {
  const out: [number, number, string][] = [];
  ALIENS[kind]!.forEach((row, r) => [...row].forEach((v, k) => +v && out.push([k + 1, r + 1, ALIEN_PAL[kind]![+v]!])));
  return `<svg viewBox="0 0 13 11" aria-hidden="true" shape-rendering="crispEdges">${rects(out)}</svg>`;
}
/** A fly (0 violet, 1 pink, 2 cyan) as an SVG. */
export function flySvg(kind: number) {
  const p = (d: string, f: string) => `<path d="${d}" fill="${f}"/>`;
  return `<svg viewBox="-1 -2 29 27" aria-hidden="true" shape-rendering="crispEdges">${p(FLY_WINGS[0]!, "#d9f0f3") + p(FLY_FEET, "#273148") + p(FLY_BODY, FLY_COLORS[kind % 3]!) + p(FLY_EYES, "#fff5d7") + p(FLY_PUPILS, "#152820")}</svg>`;
}
/** A bug at a tier (1-3) as an SVG. */
export function bugSvg(tier: number) {
  const col = BUG_COLORS[tier - 1]!, hi = BUG_LIGHT[tier - 1]!, out: [number, number, string][] = [];
  const put = (k: number, r: number, v: string) => v !== "." && out.push([k, r, v === "2" ? "#07060f" : v === "4" ? hi : col]);
  BUG.forEach((row, r) => [...row].forEach((v, k) => put(k, r, v)));
  BUG_LEGS[0]!.forEach((row, r) => [...row].forEach((v, k) => put(k, 5 + r * 2, v)));
  return `<svg viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges">${rects(out)}</svg>`;
}
/** Each wave's face: 0 Swarm Protocol's bug, 1 Null Invaders' squid, 2 Sherman Bytes' tank,
 *  3 Byte Runner's fly, 4 Crossfire: all four. */
export function factionSvg(k: number): string {
  if (k === 0) return bugSvg(3);
  if (k === 1) return alienSvg(2);
  if (k === 2) return tankSvg("#ff8a1f");
  if (k === 3) return flySvg(1);
  const cell = (i: number, x: number, y: number) => factionSvg(i).replace("<svg ", `<svg x="${x}" y="${y}" width="46" height="46" `);
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${cell(0, 2, 2) + cell(1, 52, 2) + cell(2, 2, 52) + cell(3, 52, 52)}</svg>`;
}
