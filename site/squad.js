// The squad page (play/squad/): co-op for 2 to 4 people over a fizlet-rooms room server, Battlefield
// Blitz's room card made for Crossfire. Same match on every screen: only inputs travel. The invite
// code is the server's gate, not a login. Everything about the room lives in ONE Board UI card over
// the board: join (code, your ride, room) → waiting (4 seats; P1 can start with 2 or 3 in) → the
// match (who flies or drives what, kills, the link) → someone left. An attract match runs behind
// the card until yours starts. Bundled to dist/squad.js; the game is ./dom-crossfire-net.mjs.
import { chrome, gameMode } from "./chrome.js";
import { createCrossfire, join } from "./dom-crossfire-net.mjs";

chrome();
gameMode();
const stage = document.querySelector(".cf-stage");
const card = stage.querySelector(".room"), arena = document.getElementById("cf");
const gate = document.getElementById("gate"), field = (n) => gate.elements.namedItem(n);
const $ = (s) => stage.querySelector(s);
const q = new URLSearchParams(location.search);
// The room server: the same config as Blitz (the page's data-rooms; ?rooms= overrides it for tests).
const ws = q.get("rooms") ?? stage.dataset.rooms, http = ws.replace(/^ws/, "http");
// Crossfire's rooms are the server's 8-15 (shown as 1-8), so it doesn't share Blitz's first rooms.
const ROOMS = 8, FIRST = 8, SIZE = 4;
const SEAT = ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a"];
const keep = {
  get: (k, s) => { try { return s().getItem(k) ?? ""; } catch { return ""; } },
  set: (k, v, s) => { try { s().setItem(k, v); } catch {} },
};
const tab = () => sessionStorage, device = () => localStorage;
let room = Math.min(ROOMS - 1, Math.max(0, (Number(q.get("room")) || 1) - 1));
let ride = (q.get("ride") ?? keep.get("crossfire:ride", device)) === "tank" ? "tank" : "plane";
// A ?code= link: the head script took it out of the URL and left it here (memory only).
field("code").value = window.__cfInvite || keep.get("crossfire-code", tab);
delete window.__cfInvite;
const showRoom = () => (field("roomShow").value = String(room + 1));
const showRide = () => stage.querySelectorAll("[data-ride]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ride === ride)));
showRoom();
showRide();
stage.querySelectorAll("[data-ride]").forEach((b) => b.addEventListener("click", () => ((ride = b.dataset.ride), keep.set("crossfire:ride", ride, device), showRide())));
stage.querySelectorAll("[data-room]").forEach((b) => b.addEventListener("click", () => ((room = (room + Number(b.dataset.room) + ROOMS) % ROOMS), showRoom())));

// ---------- The card: steps and header ----------
const head = (title, sub, conn) => (($("[data-title]").textContent = title), ($("[data-sub]").textContent = sub), (card.dataset.conn = conn));
const step = (s) => {
  card.dataset.step = s;
  card.classList.remove("open");
  stage.querySelector(`[data-for="${s}"] :is(input:not([type=hidden]), button:not(:disabled))`)?.focus({ preventScroll: true });
};
const say = (t) => ($("[data-say]").textContent = t);
const swatch = (i) => `<i class="sw" style="--c:${SEAT[i]}"></i>`;
const seats = (me = 0, joined = 1) =>
  ($("[data-wait-seats]").innerHTML = Array.from({ length: SIZE }, (_, i) => `<li class="${i === me ? "me" : i < joined ? "in" : "open"}">${swatch(i)}<span>${i === me ? `YOU · ${ride.toUpperCase()}` : i < joined ? `P${i + 1}` : "OPEN SEAT"}</span></li>`).join(""));

// ---------- The match ----------
let game = null, abort = null, watch = 0, link = null, ended = false, code = "";
const stop = () => {
  clearInterval(watch);
  abort?.abort();
  link?.close();
  link = null;
  game?.destroy();
  game = null;
};
const attract = () => (stop(), (game = window.crossfire = createCrossfire(arena, { demo: true })));

async function enter() {
  attract();
  head(`ROOM ${room + 1}`, `WAITING · ${SIZE} SEATS`, "wait");
  seats();
  $("[data-wait-say]").textContent = "Waiting for your squad.";
  $("[data-start]").hidden = true;
  step("wait");
  let asked = false;
  // The room's LOBBY on each join and leave: your seat, who is in; P1 with 2 or 3 in can start now.
  const lobby = (go, seat, seated, size) => {
    const open = size - seated, k = $("[data-start]");
    seats(seat, seated);
    head(`ROOM ${room + 1} · P${seat + 1}`, `WAITING · ${seated} OF ${size}`, "wait");
    k.hidden = seat > 0 || seated < 2 || !open;
    $("[data-wait-say]").textContent = !open || asked ? "Starting…" : seat ? `Waiting for P1 to start, or for ${open} more.` : seated < 2 ? "Waiting for your squad." : `${seated} in. Start now, or wait for ${open} more.`;
    k.disabled = asked;
    k.onclick = () => ((asked = k.disabled = true), ($("[data-start-say]").textContent = "STARTING…"), go(0, 0));
  };
  abort = new AbortController();
  const signal = abort.signal;
  for (let tries = 0; ; tries++) {
    try {
      // The invite rides in the WebSocket subprotocols, never the URL.
      return start(await join(`${ws}/room/${FIRST + room}?players=${SIZE}`, signal, ["fizlet-rooms", `invite.${code}`], { lobby }));
    } catch {
      if (signal.aborted) return;
      if (tries >= 3) return gone("ROOM BUSY", `Room ${room + 1} is full, mid-match, or set for another game. Try another room.`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}
function start(seat) {
  stop();
  const { slot, players } = seat;
  link = seat.transport;
  ended = false;
  head(`ROOM ${room + 1} · P${slot + 1}`, `LIVE · SQUAD OF ${players}`, "live");
  step("play");
  game = window.crossfire = createCrossfire(arena, {
    seed: seat.seed,
    ride,
    net: { transport: seat.transport, slot, players, leave: () => (attract(), head("SQUAD", "NOT CONNECTED", "off"), step("join")) },
    // Over: free the room a moment later (someone may be a few frames behind and still need our inputs).
    onEnd: () => ((ended = true), head(`ROOM ${room + 1} · P${slot + 1}`, "MATCH OVER", "off"), setTimeout(() => (link?.close(), (link = null)), 2000)),
  });
  let last = -1, still = 0;
  const tick = () => {
    if (!game || ended) return;
    const n = game.net;
    if (n.lost) return gone("PLAYER LEFT", "Someone in the squad left, so this match can't go on. Rejoin to play again.");
    still = n.frame === last ? still + 1 : 0;
    last = n.frame;
    if (still >= 16) return gone("CONNECTION LOST", "No moves have arrived for 8 seconds. Check your connection, then rejoin.");
    card.dataset.conn = still >= 3 ? "slow" : "live";
    $("[data-sub]").textContent = still >= 3 ? "WAITING FOR THE OTHERS…" : `LIVE · SQUAD OF ${players} · WAVE ${game.world.section > 4 ? "FINALE" : `S${game.world.section}·${game.world.step}`}`;
    $("[data-rows]").innerHTML = game.world.crew.map((u) => `<tr class="${u.you ? "you" : ""}${u.alive ? "" : " down"}"><th scope="row"><i class="sw" style="--c:${u.color}"></i>${u.human ? u.name : "AI"}${u.you ? " · YOU" : ""}</th><td>${u.kind ? "PLANE" : "TANK"}</td><td>${u.kills}</td></tr>`).join("");
  };
  tick();
  watch = setInterval(tick, 500);
}
function gone(word, text) {
  attract();
  head(`ROOM ${room + 1}`, word, "lost");
  $("[data-gone-word]").textContent = word;
  $("[data-gone-say]").textContent = text;
  step("gone");
}

gate.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  code = field("code").value.trim();
  if (code.length < 6) return say("Enter the invite code you were sent.");
  say("Checking the code…");
  // The room server's gate: is the code on the list? (POST, so it never lands in a URL or a log.)
  try {
    const r = await fetch(`${http}/invite`, { method: "POST", body: code, headers: { "content-type": "text/plain" } });
    if (r.status === 403) return say("That code isn't on the list.");
    if (!r.ok) return say("The room server said no. Try again in a minute.");
  } catch {
    return say("Can't reach the room server.");
  }
  say("");
  keep.set("crossfire-code", code, tab);
  void enter();
});
$("[data-cancel]").addEventListener("click", () => (attract(), head("SQUAD", "NOT CONNECTED", "off"), step("join")));
$("[data-leave]").addEventListener("click", () => (attract(), head("SQUAD", "NOT CONNECTED", "off"), step("join")));
$("[data-again]").addEventListener("click", () => void enter());
$("[data-new]").addEventListener("click", () => (attract(), step("join")));
$("[data-share]").addEventListener("click", async () => {
  const u = new URL(location.href);
  u.search = `?room=${room + 1}&code=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(u.href);
    $("[data-share-say]").textContent = "LINK COPIED";
  } catch {
    $("[data-share-say]").textContent = "COPY FAILED";
  }
});
// In a match on a phone the card is folded to its header: a tap opens or folds it.
$(".head").addEventListener("click", () => card.dataset.step === "play" && card.classList.toggle("open"));
attract();
step("join");
