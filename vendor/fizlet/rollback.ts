// @fzlt/core/presence/rollback: rollback netcode for a deterministic sim, on presence's 12-byte wire and
// room (nothing in the room server changes). Presence's lockstep waits for every input, so on a phone's
// network the sim runs only as fast as the slowest round trip; this runs every frame at once instead.
//
// Each frame runs with this screen's own input (a small delay, 1 to 3 frames, picked from the measured
// latency) and a guess for everyone else's (the last input heard from them). When a real input arrives
// that differs from the guess, the state goes back to that frame (a ring of snapshots of the sim's byte
// views, made once) and the frames since run again: the sim is deterministic, so every screen ends on
// the same state. A frame whose inputs are all real is final: `confirm` hears each one, in order, once;
// state hashes are compared on final frames only (a desync shows; it never drifts). A screen that runs
// ahead of the others (by the trip each side measures, carried in the INPUT message's spare byte) waits
// a frame now and then until they meet. At most `window` frames run past the last final one: past it
// the sim waits (a link that went quiet). A seat the room says left plays `gone` from the frame after
// its last input, on every screen. No allocation per frame.
//
// Wire: INPUT [1, seat, delay, lead × 2 (int8), frame u32, bits u32], HASH [2, seat, 0, 0, frame, hash].
// One INPUT per frame, frames rising (the room relays each once; over TCP nothing is lost or reordered,
// and a resend only follows a RESUME).
import type { Engine } from "./kernel/engine";
import { hash32, INPUT, HASH, LEAVE, RESUME, AWAY, type Transport } from "./presence";

/** Options for `rollback()`: the link, the seat, the sim (its input, step and bytes) and the window. */
export interface RollbackOptions {
  transport: Transport;
  /** This screen's seat, 0..players-1 (the room says which). */
  slot: number;
  /** Seats in the room, at most 8. */
  players: number;
  /** This screen's input bits for `frame` (called once per frame, in order, `delay` frames ahead). */
  input(frame: number): number;
  /** Run one frame from `inputs[0..players-1]`. `live`: the first time this frame runs (false: again,
   *  after a correction); `sure`: every input is real and every frame before it final (it never runs
   *  again). Return false to wait instead (nothing changed). Only the state in `bytes` may change. */
  step(inputs: Uint32Array, frame: number, live: boolean, sure: boolean): boolean | void;
  /** The sim's whole state (typed-array byte views, the seeded random's state too): saved and restored
   *  byte for byte, and hashed on final frames. */
  bytes: Uint8Array[];
  /** A final frame, in order, once, with its real inputs (a replay log, scores, sounds that must not repeat). */
  confirm?(inputs: Uint32Array, frame: number): void;
  /** Around a correction: before the state goes back (true) and after the frames ran again (false). */
  rewind?(before: boolean): void;
  /** The input bits a seat that left plays from the frame after its last one (default 0). */
  gone?: number;
  /** Frames run past the last final frame, at most, 2..100 (default 64: 1.07 s at 60 Hz). */
  window?: number;
  /** Frames between hash checks (default 30). */
  hashEvery?: number;
  /** A fixed input delay, 1..3 frames; omitted, it adapts 1..3 to the measured latency. */
  delay?: number;
}

// Input ring per seat (frames): more than 2 × window + 2 × delay + 1 (how far a seat can run ahead).
const C = 256;
const u32 = (d: Uint8Array, i: number) => (d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16) | (d[i + 3]! << 24)) >>> 0;

// Counter slots, literals named in a comment (src/kernel/engine.ts says why): 0 frame, 1 final, 2 stalls,
// 3 waits, 4 resims, 5 deepest, 6 desync, 7 lost, 8 away, 9 left, 10 dropped, 11 earliest correction,
// 12 delay, 13 own input sent to, 14 steps, 15 corrections, 16 hold (−1: none), 17 steps since a wait.

/** Rollback multiplayer on engine `e`: runs every frame at once on guessed remote inputs and runs frames
 *  again when a real input differs; final frames are hashed and compared. Read `frame`, `final`,
 *  `desync`, `delay`; `destroy()` stops it. */
export function rollback(e: Engine, o: RollbackOptions) {
  const P = o.players, me = o.slot, W = o.window ?? 64, every = o.hashEvery ?? 30, t = o.transport, gone = (o.gone ?? 0) >>> 0, fixed = o.delay ?? 0;
  if (!(me >= 0 && me < P && P <= 8) || me % 1 || !(W >= 2 && W <= 100) || !(fixed >= 0 && fixed <= 3)) throw new RangeError("rollback: slot not a seat in 0..players-1 (players ≤ 8), window not 2..100, or delay not 1..3");
  // Inputs: the real ones (tag = frame) and the ones each frame last ran with (utag = frame); hashes.
  const tag = new Int32Array(P * C).fill(-1), bits = new Uint32Array(P * C), utag = new Int32Array(P * C).fill(-1), used = new Uint32Array(P * C);
  const htag = new Int32Array(P * C).fill(-1), hval = new Uint32Array(P * C);
  // Per seat: the newest frame heard, its bits, the frame its `gone` starts (−1), its delay.
  const top = new Int32Array(P).fill(-1), lastB = new Uint32Array(P), from = new Int32Array(P).fill(-1), theirD = new Int32Array(P).fill(2);
  // Leads (frames this screen runs ahead of seat s, as its inputs show, the trip included): the least
  // seen over the last half second to second (jitter and spikes only ever add to a trip), and what s
  // says of its own lead (the same, from its side).
  const lead = new Float64Array(P), cur = new Float64Array(P).fill(Infinity), prev = new Float64Array(P).fill(Infinity), theirs = new Float64Array(P), heard = new Uint8Array(P);
  // Snapshots: the state at the start of frame f in slot f % SN, and their views, made once.
  const views = o.bytes, size = views.reduce((m, v) => m + v.length, 0), SN = W + 2, snap = new Uint8Array(size * SN);
  let at0 = 0;
  const part = views.map((v) => {
    const a = at0;
    at0 += v.length;
    return Array.from({ length: SN }, (_, k) => snap.subarray(k * size + a, k * size + a + v.length));
  });
  const whole = Array.from({ length: SN }, (_, k) => snap.subarray(k * size, (k + 1) * size));
  const now = new Uint32Array(P), out = new Uint8Array(12), T = new Float64Array(2), n = new Int32Array(18);
  n[6] = n[13] = n[16] = -1;
  n[11] = 0x7fffffff;
  n[12] = fixed || 1;

  const save = (f: number) => {
    for (let i = 0, k = f % SN; i < views.length; i++) part[i]![k]!.set(views[i]!);
  };
  const load = (f: number) => {
    for (let i = 0, k = f % SN; i < views.length; i++) views[i]!.set(part[i]![k]!);
  };
  /** The mean over the seats still playing of `lead[s] + sign × theirs[s]`, or 0. */
  const mean = (sign: number) => {
    let m = 0, c = 0;
    for (let s = 0; s < P; s++) if (s !== me && heard[s] && from[s]! < 0) (m += lead[s]! + sign * theirs[s]!), c++;
    return c ? m / c : 0;
  };
  const send = (k: number, f: number, v: number) => {
    out[0] = k, out[1] = me, out[2] = k === INPUT ? n[12]! : 0;
    out[3] = k === INPUT ? Math.max(-127, Math.min(127, Math.round(mean(0) * 2))) & 255 : 0;
    out[4] = f, out[5] = f >>> 8, out[6] = f >>> 16, out[7] = f >>> 24;
    out[8] = v, out[9] = v >>> 8, out[10] = v >>> 16, out[11] = v >>> 24;
    t.send(out);
  };
  const sendInput = (g: number) => send(INPUT, g, bits[me * C + (g % C)]!);
  /** Seat s's real input for frame f, or −1. */
  const real = (s: number, f: number) => {
    const i = s * C + (f % C);
    if (s === me) return f <= n[13]! && tag[i] === f ? bits[i]! : -1;
    if (from[s]! >= 0 && f >= from[s]!) return gone;
    return tag[i] === f ? bits[i]! : -1;
  };
  /** Fill `now` with frame f's inputs (real or guessed); true if every one is real. */
  const gather = (f: number) => {
    let all = true;
    for (let s = 0; s < P; s++) {
      const r = real(s, f), i = s * C + (f % C);
      if (r >= 0) now[s] = r;
      else (now[s] = top[s]! >= 0 ? lastB[s]! : 0), (all = false);
      (utag[i] = f), (used[i] = now[s]!);
    }
    return all;
  };
  const check = (s: number, f: number, h: number) => {
    const i = f % C;
    for (let j = 0; j < P; j++) if (j !== s && htag[j * C + i] === f && hval[j * C + i] !== h >>> 0 && n[6]! < 0) n[6] = f;
    htag[s * C + i] = f;
    hval[s * C + i] = h;
  };
  /** Frame f (== final) ran on real inputs only: it is final. */
  const finish = (f: number) => {
    n[1] = f + 1;
    o.confirm?.(now, f);
    if ((f + 1) % every === 0) {
      const h = hash32(whole[(f + 1) % SN]!);
      check(me, f + 1, h);
      send(HASH, f + 1, h);
    }
  };
  /** Frames past `final` whose guesses all came true are final too (no need to run them again). */
  const settle = () => {
    for (let f = n[1]!; f < n[0]!; f++) {
      for (let s = 0; s < P; s++) {
        const r = real(s, f), i = s * C + (f % C);
        if (r < 0 || utag[i] !== f || used[i] !== r >>> 0) return;
        now[s] = r;
      }
      finish(f);
    }
  };
  const mark = (f: number) => {
    if (f < n[0]! && f < n[11]!) n[11] = f;
  };
  const receive = (d: Uint8Array) => {
    if (d.length < 12) return;
    const k = d[0]!, s = d[1]!, f = u32(d, 4) | 0;
    if (s >= P) return;
    if (k === LEAVE || k === RESUME || k === AWAY) {
      n[8] = (n[8]! & ~(1 << s)) | (k === AWAY ? 1 << s : 0);
      if (k === LEAVE) {
        n[7] = n[7]! | (1 << s);
        // Every screen heard the same last input from it (the room relays in order, LEAVE last).
        if (s !== me && from[s]! < 0) (from[s] = Math.max(top[s]! + 1, 0)), (n[9] = n[9]! | (1 << s)), mark(from[s]!);
      } else if (k === RESUME) for (let g = n[1]!; g <= n[13]!; g++) if (tag[me * C + (g % C)] === g) sendInput(g);
      return;
    }
    if (s === me) return;
    if (k === INPUT) {
      const i = s * C + (f % C);
      if (f < n[1]! || f >= n[1]! + C || tag[i] === f || from[s]! >= 0) return void (n[10] = n[10]! + 1);
      const b = u32(d, 8);
      (tag[i] = f), (bits[i] = b);
      if (f > top[s]!) (top[s] = f), (lastB[s] = b);
      // (A resume replays a seat's inputs with the seat count in byte 2: only 1..3 is a delay.)
      if (d[2]! >= 1 && d[2]! <= 3) theirD[s] = d[2]!;
      // How far ahead this screen runs of seat s (its frame when it sent: f − its delay), the least
      // lately; and how far ahead s says it runs of everyone.
      const ahead = n[0]! - (f - theirD[s]!);
      if (ahead < cur[s]!) cur[s] = ahead;
      lead[s] = Math.min(cur[s]!, prev[s]!);
      theirs[s] = ((d[3]! << 24) >> 24) / 2;
      heard[s] = 1;
      if (utag[i] === f && used[i] !== b) mark(f);
    } else if (k === HASH && f > n[1]! - C && f < n[1]! + C) check(s, f, u32(d, 8));
    else n[10] = n[10]! + 1;
  };
  /** Run frame f (the state is at its start); false if the step asked to wait. */
  const run = (f: number, live: boolean) => {
    const sure = gather(f) && f === n[1]!;
    if (o.step(now, f, live, sure) === false) return false;
    n[0] = f + 1;
    save(f + 1);
    if (sure) finish(f);
    return true;
  };
  const system = {
    step() {
      n[14] = n[14]! + 1;
      n[17] = n[17]! + 1;
      // A correction: back to the earliest frame that ran on a wrong guess, and forward again.
      const rb = n[11]!;
      if (rb < n[0]!) {
        const to = n[0]!, t0 = performance.now();
        o.rewind?.(true);
        load(rb);
        n[0] = rb;
        n[15] = n[15]! + 1;
        for (let f = rb; f < to; f++) if (!run(f, false)) break;
        n[4] = n[4]! + n[0]! - rb;
        if (n[0]! - rb > n[5]!) n[5] = n[0]! - rb;
        o.rewind?.(false);
        T[0] = Math.max(T[0]!, performance.now() - t0);
        T[1] = T[1]! + performance.now() - t0;
      }
      n[11] = 0x7fffffff;
      settle();
      if (n[14]! % 30 === 0) {
        // Every second: the delay from the trip (lead + theirs ≈ twice the one-way time, in frames).
        if (!fixed && n[14]! % 60 === 0) {
          const one = mean(1) / 2;
          n[12] = one < 7 ? 1 : one < 13 ? 2 : 3;
        }
        for (let s = 0; s < P; s++) (prev[s] = cur[s]!), (cur[s] = Infinity);
      }
      const F = n[0]!;
      if (n[16]! >= 0 && F >= n[16]!) return;
      if (F - n[1]! >= W) return void (n[2] = n[2]! + 1);
      // Time sync: ahead of the others (each side's measured lead, halved: the trip cancels)? One frame
      // in 8 a little ahead, one in 3 further, every other far ahead (a slow screen): the others slow
      // to its pace a frame at a time instead of filling the window and stopping.
      const by = mean(-1) / 2;
      if (by > 1 && n[17]! >= (by > 8 ? 2 : by > 4 ? 3 : 8)) return (n[17] = 0), void (n[3] = n[3]! + 1);
      // This screen's input, `delay` frames ahead (each frame once, in order).
      for (let g = n[13]! + 1; g <= F + n[12]!; g++) {
        const i = me * C + (g % C);
        (tag[i] = g), (bits[i] = o.input(g) >>> 0), (n[13] = g);
        sendInput(g);
      }
      if (!run(F, true)) n[2] = n[2]! + 1;
    },
  };
  // Frame 0's state, and the link.
  save(0);
  e.add(system);
  t.listen(receive);
  const destroy = () => (e.remove(system), t.listen(null), t.close());
  e.signal.addEventListener("abort", destroy, { once: true });
  return {
    /** Frames run so far on this screen (some on guesses). */
    get frame() {
      return n[0]!;
    },
    /** Frames final so far (every input real): the same frames on every screen, maybe at different times. */
    get final() {
      return n[1]!;
    },
    /** Engine steps the sim waited: the window was full (someone went quiet) or a step asked to. */
    get stalls() {
      return n[2]!;
    },
    /** Engine steps this screen waited a frame for the others to catch up (time sync). */
    get waits() {
      return n[3]!;
    },
    /** Frames run again after corrections, in all. */
    get resims() {
      return n[4]!;
    },
    /** The deepest correction (frames run again at once). */
    get deepest() {
      return n[5]!;
    },
    /** Corrections so far. */
    get corrections() {
      return n[15]!;
    },
    /** The slowest correction so far (ms, the frames run again). */
    get resimMs() {
      return T[0]!;
    },
    /** All the time spent running frames again (ms). */
    get resimTotal() {
      return T[1]!;
    },
    /** Engine steps so far. */
    get steps() {
      return n[14]!;
    },
    /** The input delay now (frames, 1..3). */
    get delay() {
      return n[12]!;
    },
    /** How far this screen runs ahead of the others (frames, the mean over the seats still playing). */
    get lead() {
      return mean(-1) / 2;
    },
    /** The first frame whose state hash differed from a seat's, or −1. */
    get desync() {
      return n[6]!;
    },
    /** Seats the room said left, as bits (this one too when its own link is gone for good). */
    get lost() {
      return n[7]!;
    },
    /** Seats reconnecting, as bits. */
    get away() {
      return n[8]!;
    },
    /** Other seats that left (they play `gone`), as bits. */
    get left() {
      return n[9]!;
    },
    /** The frame seat s's `gone` starts, or −1 (it has not left). */
    leftAt: (s: number) => from[s] ?? -1,
    /** Messages ignored: late, repeated, out of the ring or of an unknown kind. */
    get dropped() {
      return n[10]!;
    },
    /** Stop running new frames at `frame` (−1: run on); inputs and corrections still land (tests, a
     *  match's end). */
    set hold(frame: number) {
      n[16] = frame;
    },
    /** Stop: the system leaves the engine, the link closes. */
    destroy,
  };
}
/** What `rollback()` returns. */
export type Rollback = ReturnType<typeof rollback>;
