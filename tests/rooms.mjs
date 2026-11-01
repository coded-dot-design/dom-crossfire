// A stand-in fizlet-rooms room server for the browser tests (no network, nothing deployed): Playwright
// routes the page's WebSocket and its POST /invite here. It speaks the room's 12-byte wire format:
// LOBBY to every waiting seat on each join, START from seat 0 (begin with the seats taken), WELCOME
// with the slot, the players and the seed when the room starts, and INPUT / HASH relayed to the others.
const WELCOME = 3, LEAVE = 4, START = 7, LOBBY = 8;
const msg = (kind, slot, players, seed = 0) => {
  const b = Buffer.alloc(12);
  (b[0] = kind), (b[1] = slot), (b[2] = players), b.writeUInt32LE(seed >>> 0, 4);
  return b;
};

/** One shared set of rooms for every context in a test: `await rooms.attach(context)`. */
export function rooms({ code = "CROSSFIRE-TEST", seed = 1234 } = {}) {
  const all = new Map();
  const room = (id, size) => all.get(id) ?? (all.set(id, { size, seats: [], started: false }), all.get(id));
  const lobby = (r) => r.seats.forEach((ws, s) => ws.send(msg(LOBBY, s, r.size).fill(r.seats.length, 3, 4)));
  const begin = (r) => {
    r.started = true;
    r.players = r.seats.length;
    r.seats.forEach((ws, s) => ws.send(msg(WELCOME, s, r.players, seed)));
  };
  return {
    rooms: all,
    async attach(context, origin = "wss://rooms.test") {
      await context.route(origin.replace(/^ws/, "http") + "/invite", (route) =>
        route.fulfill(route.request().postData() === code ? { status: 200, contentType: "application/json", body: '{"ok":true,"players":4}' } : { status: 403, contentType: "application/json", body: '{"ok":false}' }),
      );
      await context.routeWebSocket(new RegExp(`^${origin.replace(/[./]/g, "\\$&")}/room/\\d+`), (ws) => {
        const u = new URL(ws.url()), r = room(u.pathname, Number(u.searchParams.get("players") || 2));
        if (r.started || r.seats.length >= r.size) return ws.close({ code: 4409, reason: "busy" });
        const slot = r.seats.push(ws) - 1;
        ws.onMessage((m) => {
          const d = Buffer.from(m);
          if (d[0] === START && slot === 0 && !r.started) return begin(r);
          if (r.started) r.seats.forEach((o, s) => s !== slot && o.send(d));
        });
        ws.onClose(() => r.started && r.seats.forEach((o, s) => s !== slot && o.send(msg(LEAVE, slot, r.players))));
        if (r.seats.length === r.size) begin(r);
        else lobby(r);
      });
    },
  };
}
