// @fzlt/core/presence: lockstep input exchange for multiplayer, behind a tiny transport adapter.
// Every peer runs the same fixed-step simulation from the same seed. Each sim frame needs every
// player's input for that frame; your own input is sent `delay` frames ahead, so on a good link the
// game never waits. A missing input stalls the sim (never guesses), so peers can't drift apart.
// Inputs live in fixed rings of typed arrays: a confirmed per-frame input log a rollback layer can
// replay. State hashes are exchanged every `hashEvery` frames to catch a desync early.
import type { Engine, System } from "./kernel/engine";
import { seeded } from "./kernel/random";

/** Wire kinds. Every message is 12 bytes: kind, slot, players, mode, u32 frame (or seed), u32 value
 *  (or token). From the room: WELCOME, LEAVE, RESUME (a seat is back: resend), AWAY (a seat dropped and
 *  may come back), LOBBY (before the start: your seat, room size, seated); START goes to the room from
 *  the host (the protocol: /guides/build-your-own-room-server/). */
export const INPUT = 1, HASH = 2, WELCOME = 3, LEAVE = 4, RESUME = 5, AWAY = 6, START = 7, LOBBY = 8;
const m12 = (k: number, s: number, a = 0, b = 0) => Uint8Array.of(k, s, a, b, 0, 0, 0, 0, 0, 0, 0, 0);
const u32 = (d: Uint8Array, i: number) => (d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16) | (d[i + 3]! << 24)) >>> 0;

/** Moves 12-byte messages to the room (or the other peers) and back. */
export interface Transport {
  /** Send one message. The buffer is reused: copy it before returning. */
  send(data: Uint8Array): void;
  /** Deliver every incoming message to `fn` (messages that arrived earlier are flushed to it). */
  listen(fn: ((data: Uint8Array) => void) | null): void;
  close(): void;
}

/** Options for `presence()`: the transport, this peer's seat, the number of players, the input delay
 *  and the ring sizes. */
export interface PresenceOptions {
  transport: Transport;
  /** This peer's seat, 0..players-1 (the room says which). */
  slot: number;
  players: number;
  /** Frames of input delay (default 2: 33 ms at 60 Hz). */
  delay?: number;
  /** Input frames kept per player (default 64; at least 2 × delay + 2). */
  cap?: number;
  /** This player's input for the frame being scheduled, as bits (read latched intents here). */
  input(): number;
  /** The simulation for one frame: same inputs + same seed → same state on every peer. */
  step(e: Engine, inputs: Uint32Array, frame: number): void;
  /** A hash of the sim state (see `hash32`); compared across peers to catch a desync. */
  hash?(): number;
  /** Frames between hash checks (default 30). */
  hashEvery?: number;
}

// Stats slots, literals named in a comment (src/kernel/engine.ts says why): 0 FRAME, 1 STALLS, 2 DROPPED, 3 DESYNC, 4 LOST, 5 GONE. Message types: the exported INPUT…LOBBY.

/** Lockstep multiplayer on engine `e`: each sim frame waits for every player's input (sent `delay`
 *  frames ahead), so peers never drift; state hashes are compared to catch a desync. Read `frame`,
 *  `stalls`, `desync` and `lost`; `destroy()` stops it. */
export function presence(e: Engine, o: PresenceOptions) {
  const P = o.players, me = o.slot, D = o.delay ?? 2, C = o.cap ?? 64, every = o.hashEvery ?? 30, t = o.transport;
  // A seat outside 0..players-1 (or a fraction) would never store its own input: the sim would stall
  // for good without a word. Seats are bits in `lost`, so at most 32 players.
  if (C < D * 2 + 2 || !(me >= 0 && me < P && P < 33) || me % 1) throw new RangeError("presence: cap < 2 × delay + 2, or slot not a seat in 0..players-1 (players ≤ 32)");
  // One ring slot per (player, frame % cap): the frame it holds and the bits; same for hashes.
  const tag = new Int32Array(P * C).fill(-1), bits = new Uint32Array(P * C);
  const htag = new Int32Array(P * C).fill(-1), hval = new Uint32Array(P * C);
  const now = new Uint32Array(P), n = new Int32Array(6), out = new Uint8Array(12);
  n[3 /* DESYNC */] = -1;
  const put = (s: number, f: number, b: number) => ((tag[s * C + (f % C)] = f), (bits[s * C + (f % C)] = b));
  for (let s = 0; s < P; s++) for (let f = 0; f < D; f++) put(s, f, 0);
  const send = (k: number, f: number, v: number) => {
    out[0] = k, out[1] = me, out[4] = f, out[5] = f >>> 8, out[6] = f >>> 16, out[7] = f >>> 24;
    out[8] = v, out[9] = v >>> 8, out[10] = v >>> 16, out[11] = v >>> 24;
    t.send(out);
  };
  const check = (s: number, f: number, h: number) => {
    const i = f % C;
    for (let j = 0; j < P; j++) if (j !== s && htag[j * C + i] === f && hval[j * C + i] !== h >>> 0 && n[3 /* DESYNC */]! < 0) n[3 /* DESYNC */] = f;
    htag[s * C + i] = f;
    hval[s * C + i] = h;
  };
  const receive = (d: Uint8Array) => {
    const k = d[0]!, s = d[1]!, f = u32(d, 4) | 0, F = n[0 /* FRAME */]!, i = s * C + (f % C);
    if (d.length < 12 || s >= P) return;
    // The room's word on a seat (this one too): LEAVE, RESUME (back: resend this seat's inputs
    // F-D..F+D-1, which a peer may have missed while a link was down; in lockstep no peer is more
    // than D frames away; repeats are dropped, first write wins) or AWAY (dropped, may come back).
    if (k > 3 && k < 7) {
      n[5 /* GONE */]! &= ~(1 << s);
      if (k > 5) n[5 /* GONE */]! |= 1 << s;
      else if (k < 5) n[4 /* LOST */]! |= 1 << s;
      else for (let g = F > D * 2 ? F - D : D; g < F + D; g++) if (tag[me * C + (g % C)] === g) send(INPUT, g, bits[me * C + (g % C)]!);
    }
    // First write wins: a second INPUT or HASH for a frame a seat already sent is dropped, so a
    // peer that sends two different inputs for one frame can't split the others' sims.
    else if (s === me) return;
    else if (k === INPUT && f >= F && f < F + C && tag[i] !== f) put(s, f, u32(d, 8));
    else if (k === HASH && f > F - C && f < F + C && htag[i] !== f) check(s, f, u32(d, 8));
    else n[2 /* DROPPED */]!++;
  };
  const system: System = {
    step(e) {
      const f = n[0 /* FRAME */]!;
      for (let s = 0; s < P; s++) {
        const i = s * C + (f % C);
        if (tag[i] !== f) return void n[1 /* STALLS */]!++; // lockstep: wait, never guess
        now[s] = bits[i]!;
      }
      const b = o.input() >>> 0;
      put(me, f + D, b);
      send(1 /* INPUT */, f + D, b);
      o.step(e, now, f);
      n[0 /* FRAME */] = f + 1;
      if (o.hash && (f + 1) % every === 0) {
        const h = o.hash() >>> 0;
        check(me, f + 1, h);
        send(2 /* HASH */, f + 1, h);
      }
    },
  };
  e.add(system);
  t.listen(receive);
  const stop = () => (e.remove(system), t.listen(null), t.close());
  e.signal.addEventListener("abort", stop, { once: true });
  return {
    system,
    /** Sim frames run so far (every peer passes the same frames, maybe at different times). */
    get frame() {
      return n[0 /* FRAME */]!;
    },
    /** Engine steps spent waiting for someone's input. */
    get stalls() {
      return n[1 /* STALLS */]!;
    },
    /** Messages refused (out of the window, bad seat, a second input or hash for one frame). */
    get dropped() {
      return n[2 /* DROPPED */]!;
    },
    /** First frame whose state hash differed from a peer's, or -1. */
    get desync() {
      return n[3 /* DESYNC */]!;
    },
    /** Bitmask of seats the room said left (their frames never arrive: the sim waits). */
    get lost() {
      return n[4 /* LOST */]!;
    },
    /** Bitmask of seats reconnecting (dropped, may come back; this one too, while `join`'s link retries). */
    get away() {
      return n[5 /* GONE */]!;
    },
    /** The confirmed input of `slot` for `frame`, or -1 if it isn't known (yet, or any more). */
    confirmed(slot: number, frame: number) {
      const i = slot * C + (frame % C);
      return tag[i] === frame ? bits[i]! : -1;
    },
    destroy: stop,
  };
}
/** The lockstep session `presence()` returns. */
export type Presence = ReturnType<typeof presence>;

/** FNV-1a over bytes: hash a byte view of your state's typed arrays (make the view once). */
export function hash32(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619);
  return h >>> 0;
}

/** In-memory hub: `peers` transports that broadcast to each other (like the room relay) after
 *  `latency` ± `jitter` ticks. Call `tick()` once per frame. Bounded: `cap` messages in flight. */
export function memory(o: { peers: number; latency?: number; jitter?: number; seed?: number; cap?: number }) {
  const cap = o.cap ?? 1024, lat = o.latency ?? 0, jit = o.jitter ?? 0, rnd = seeded(o.seed ?? 1);
  const buf = new Uint8Array(cap * 12), due = new Int32Array(cap), to = new Uint8Array(cap), n = new Int32Array(3); // clock, queued, dropped
  const fns: (((d: Uint8Array) => void) | null)[] = [], scratch = new Uint8Array(12);
  const ends: Transport[] = [];
  for (let p = 0; p < o.peers; p++) {
    fns.push(null);
    ends.push({
      send(d) {
        for (let q = 0; q < o.peers; q++) {
          if (q === p) continue;
          const k = n[1]!;
          if (k === cap) return void n[2]!++;
          for (let b = 0; b < 12; b++) buf[k * 12 + b] = d[b]!;
          due[k] = n[0]! + lat + (jit ? (rnd() * (jit + 1)) | 0 : 0);
          to[k] = q;
          n[1] = k + 1;
        }
      },
      listen: (fn) => (fns[p] = fn),
      close: () => (fns[p] = null),
    });
  }
  return {
    ends,
    /** Advance the link clock one tick and deliver what's due (later messages may overtake). */
    tick() {
      const c = ++n[0]!;
      let w = 0;
      for (let k = 0; k < n[1]!; k++) {
        if (due[k]! <= c) {
          for (let b = 0; b < 12; b++) scratch[b] = buf[k * 12 + b]!;
          fns[to[k]!]?.(scratch);
        } else {
          if (w !== k) (buf.copyWithin(w * 12, k * 12, k * 12 + 12), (due[w] = due[k]!), (to[w] = to[k]!));
          w++;
        }
      }
      n[1] = w;
    },
    get queued() {
      return n[1]!;
    },
    get dropped() {
      return n[2]!;
    },
  };
}

/** Wrap an open-or-opening WebSocket as a transport. Messages before `listen` are kept (≤ 256).
 *  `send` takes presence's 12-byte messages (the room refuses any other size). `eat` (join's) sees each
 *  message first and keeps it from the listener when it returns true. */
export function websocket(ws: WebSocket, eat?: (d: Uint8Array) => unknown): Transport {
  let fn: ((d: Uint8Array) => void) | null = null;
  const early: Uint8Array[] = [];
  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data === "string") return;
    const d = new Uint8Array(ev.data as ArrayBuffer);
    if (eat?.(d)) return;
    if (fn) fn(d);
    else if (early.length < 256) early.push(d);
  });
  return {
    // WebSocket.send copies the bytes before it returns, so the reused buffer goes as is: a copy
    // here allocated one array per message, from inside presence's step.
    send: (d) => void (ws.readyState === 1 && ws.send(d as Uint8Array<ArrayBuffer>)),
    listen(f) {
      fn = f;
      while (f && early.length) f(early.shift()!);
    },
    // 1000: a leave (the room holds a seat only for a drop).
    close: () => ws.close(1000),
  };
}

/** Options for `join()`. */
export interface JoinOptions {
  /** Reconnect tries after a drop, 250 ms apart and doubling (default 6: about 16 s; 0: off). Meanwhile
   *  `away` has this seat's bit (the others see AWAY); when they run out, `lost` (LEAVE). */
  retry?: number;
  /** Called on each LOBBY from the room before the start (on every join and leave): this player's
   *  `seat`, how many are `seated`, the room `size`. Seat 0 is the host: its `start(seats, mode)` asks
   *  the room to begin once `seats` are taken (0: now) with the seats it has; `mode` (0..255) reaches
   *  every peer. Other seats' starts are ignored by the room. */
  lobby?(start: (seats?: number, mode?: number) => void, seat: number, seated: number, size: number): void;
}

/** Join a room (a server speaking the `fizlet-rooms` subprotocol): resolves when the room starts with
 *  your seat, the player count, the shared seed and the host's `mode`. `protocols` go to the WebSocket
 *  handshake: the room reads its access token there (`["fizlet-rooms", "invite." + code]`), so the code stays out of the URL and the
 *  logs. A dropped link (1006, or a server restart: 1011, 1012, 1014) reconnects on its own (`o.retry`) with the seat's resume token, kept in
 *  memory only (never in a URL); the room's own closes (idle, full, seat gone, the caps) end it. */
export function join(url: string, signal?: AbortSignal, protocols?: string | string[], o: JoinOptions = {}) {
  return new Promise<{ transport: Transport; slot: number; players: number; seed: number; mode: number }>((ok, fail) => {
    // tries < 0: closed for good. `cur` is the link to the current socket; `t` outlives it.
    let cur: Transport, fn: ((d: Uint8Array) => void) | null = null, me = -1, token = 0, tries = 0;
    const t: Transport = { send: (d) => cur.send(d), listen: (f) => cur.listen((fn = f)), close: () => ((tries = -1), cur.close()) };
    const bye = () => (t.close(), me < 0 ? fail(new Error("presence: room closed")) : fn?.(m12(LEAVE, me)));
    const open = (p?: string | string[]) => {
      const ws = new WebSocket(url, p);
      // WELCOME and LOBBY are eaten (after a resume, the room's RESUME tells presence to resend).
      cur = websocket(ws, (d) =>
        d[0] === LOBBY
          ? (o.lobby?.((n = 0, m = 0) => t.send(m12(START, 0, n, m)), d[1]!, d[3]!, d[2]!), 1)
          : d[0] === WELCOME && ((tries = 0), me < 0 && ((me = d[1]!), (token = u32(d, 8)), ok({ transport: t, slot: me, players: d[2]!, seed: u32(d, 4), mode: d[3]! })), 1),
      );
      if (fn) cur.listen(fn);
      // A drop (1006, 1011, 1012, 1014: the server holds the seat) resumes: bits 0, 5, 6, 8 of 0x161 from
      // 1006. `>>> 0 > 8` keeps the shift in range (JS takes shift counts mod 32). Any other close ends it.
      ws.onclose = (ev, c = ev.code - 1006) => {
        if (tries < 0) return;
        if (me < 0 || !token || tries >= (o.retry ?? 6) || c >>> 0 > 8 || !((0x161 >> c) & 1)) return bye();
        tries++ || fn?.(m12(AWAY, me));
        setTimeout(() => tries < 0 || open([...[protocols ?? []].flat(), "resume." + token.toString(16)]), 125 << tries);
      };
    };
    open(protocols);
    signal?.addEventListener("abort", () => me < 0 && bye());
  });
}
