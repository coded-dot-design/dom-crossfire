// DOM Crossfire with squad play (dist/dom-crossfire-net.mjs): the module plus @fzlt/core/presence, so
// createCrossfire(host, { seed, net }) runs a lockstep co-op match for 2 to 4 people. The drop-in and
// dom-crossfire.mjs stay solo (Battlefield Blitz's split, src/net.ts there).
import { presence, websocket, WELCOME } from "../vendor/fizlet/presence";
import { useLockstep } from "./game";
useLockstep(presence);
export * from "./index";
// Link peers in memory (tests, one-page demos).
export { memory } from "../vendor/fizlet/presence";

/** fizlet-rooms. START: the host (seat 0) → room, [7, 0, n, mode, 0…]: begin once n seats are taken
 *  (0: now), renumbered 0..k-1; WELCOME then says players = k. LOBBY: room → every waiting seat on each
 *  join and leave before the start, [8, your seat, room size, seated, 0…]. */
export const START = 7, LOBBY = 8;

/** Join a fizlet-rooms room (WebSocket): resolves when it starts with your seat, the people in and the
 *  room's seed. `o.lobby(start, seat, seated, size)` runs on each LOBBY; the host's START NOW calls
 *  `start(seats)`. Blitz's join (src/net.ts there), unchanged. */
export function join(url: string, signal?: AbortSignal, protocols?: string | string[], o: { lobby?(start: (seats?: number, mode?: number) => void, seat: number, seated: number, size: number): void } = {}) {
  return new Promise<{ transport: ReturnType<typeof websocket>; slot: number; players: number; seed: number; mode: number }>((ok, fail) => {
    const ws = new WebSocket(url, protocols), t = websocket(ws);
    const bye = () => (t.close(), fail(new Error("presence: room closed")));
    ws.addEventListener("close", bye);
    ws.addEventListener("error", bye);
    signal?.addEventListener("abort", bye);
    t.listen((d) => {
      if (d[0] === LOBBY) return o.lobby?.((n = 0, m = 0) => t.send(new Uint8Array([START, 0, n, m, 0, 0, 0, 0, 0, 0, 0, 0])), d[1]!, d[3]!, d[2]!);
      if (d[0] !== WELCOME) return;
      t.listen(null);
      ws.removeEventListener("close", bye);
      ws.removeEventListener("error", bye);
      signal?.removeEventListener("abort", bye);
      ok({ transport: t, slot: d[1]!, players: d[2]!, seed: (d[4]! | (d[5]! << 8) | (d[6]! << 16) | (d[7]! << 24)) >>> 0, mode: d[3]! });
    });
  });
}
