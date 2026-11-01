/** DOM Crossfire as a module: the game (board, drop-in or attract mode) and the drop-in installer. */
export { createCrossfire, FACTIONS } from "./game";
export type { CrossfireOptions, CrossfireResult, Crossfire, Ride } from "./game";
export { install } from "./embed";
