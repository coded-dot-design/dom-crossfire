// Generated from the Fizlet factory's game-type table (type "shooter": Shooter). Edit the game, not
// this file's shape: the HUD preset options, pad scheme, actions and round length the shell reads.
import type { SkirmishOptions } from "../vendor/fizlet/arcade";

export const TYPE = "shooter";
/** Seats in a match (1: solo; 2+: fizlet/presence lockstep, src/net.ts). */
export const PLAYERS = 1;
/** Seconds in a round (the clock readout counts down from here). */
export const ROUND = 150;
export const PAD: "stick" | "dpad" = "stick";
export const FIRE = true;
export const ACTIONS = [];
export const HUD: SkirmishOptions = {
  readouts: [
    { label: "Score", tone: "team" },
    { label: "CH" },
    { label: "Signal", kind: "bar", low: 0.2 },
    { label: "Armor", kind: "bar", low: 0.3 }
  ],
  nav: [
    "auto"
  ],
  result: {
    stats: ["score", "channels"],
    best: "score"
  },
  header: [
    "fullscreen",
    "sound",
    "pause",
    "exit"
  ]
};
/** A networked match: no pause or surrender (one seat can't stop the others' clocks). */
export const NET_HUD: SkirmishOptions = { ...HUD, header: ["sound", "exit"], overlays: ["countdown", "result"], nav: (HUD.nav ?? []).filter((k) => k !== "restart") };
