# DOM Crossfire

**The virus scrambled the cartridges.** One arena, one score. Every 30 seconds the console
glitches and the rules change channel between five DOM VIRUS games: same stick, new game.
Survive all five.

By [Chris Cooley](https://coded.design/) · built on [Fizlet](https://github.com/coded-dot-design/fizlet) · MIT

| CH | Cartridge | The rules on air |
|---|---|---|
| 1 | Null Invaders | The fleet marches and descends; slide along the bottom and shoot up. |
| 2 | Byte Runner | No gun. Eat the bytes; a power byte makes the flies edible. |
| 3 | Sherman Bytes | The hull turns before it drives; the turret aims itself at the pillboxes. |
| 4 | Swarm Protocol | The swarm floods in from every edge; fire where you last moved. |
| 5 | DOM Battlefield | One tile per step, squads step on the beat, grab the flags. |

CH1 is always first; the other four come in a seeded order. Survive a channel for a bonus and a
little armor back, then the glitch: a CRT tear, colour bars, static and a channel number that
surfs. Reduced motion gets a still card instead.

```js
import { createDomCrossfire } from "./dist/dom-crossfire.mjs";
const game = createDomCrossfire();
game.start(); // countdown, play, pause (P), result
// Escape (or game.stop()) gives the page back exactly as it was.
```

## Controls

- Arrows / WASD / touch stick — move
- Space / hold the pointer — fire
- P — pause · Esc — give the page back

## Develop

```sh
npm ci
npm run check        # typecheck, build dist/, size budget (41,691 bytes gzip)
npm test             # deterministic replay; the sim step allocates nothing (0 young GCs)
npm run test:settle  # the engine never sleeps mid-match, and stays quiet when paused or recalled
npm run test:browser # Chromium: countdown, moves, pause, the bar drags, touch lock, result, Recall
npm run play         # the board page (index.html) on localhost: press PLAY
```

`vendor/fizlet` is a committed snapshot of Fizlet's source at the `@fzlt/core` 0.21.2 release
(tag `v0.21.2`), with its provenance in `vendor/fizlet/ORIGIN.json`. Never edit it by hand: to
move to another release, check out that tag of
[coded-dot-design/fizlet](https://github.com/coded-dot-design/fizlet) next to this repo (or set
`FIZLET_DIR`) and run `npm run sync`.

`src/rules.ts` holds the five cartridges and the channel surf (start here); `src/world.ts` and
`src/sim.ts` are the deterministic world and step; `src/game.ts` is the arcade shell, the CRT
arena and the glitch. Fizlet bricks used: `@fzlt/core/input`, `@fzlt/core/pad`, `@fzlt/core/hud`,
`@fzlt/core/match`, `@fzlt/core/sound`, `@fzlt/core/ui`, `@fzlt/core/collide`, `@fzlt/core/sprite`.
