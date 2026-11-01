# DOM Crossfire

**Pick a ride. Two rides, four armies.** Fly the plane or drive the tank; the other one fights
beside you as your AI partner. The bad guys of four DOM VIRUS games come at you in waves, then all
four at once.

By [Chris Cooley](https://coded.design/) · built on [Battlefield Blitz](https://github.com/coded-dot-design/dom-battlefield-blitz)
and [Fizlet](https://fizlet.com/) · MIT

- **Play:** https://crossfire.domvirus.com/play/
- **About:** https://crossfire.domvirus.com/
- **Drop-in:** `<script src="https://crossfire.domvirus.com/dist/dom-crossfire.js" defer></script>`

## The game

**Two rides.** Pick on the start screen (it remembers); the one you don't pick is your partner.

| | The plane (Null Invaders' interceptor) | The tank (Battlefield Blitz's tank) |
|---|---|---|
| Takes | 4 hits | 6 hits |
| Moves | flies over cover and mines | drives round cover, squashes small bugs |
| Guns | Pulse → Twin → Trident → Overdrive as it scores | a fast cannon that overheats if you hold it |
| Special (E) | SALVO: four homing rockets | LONG: a guided round that punches through cover |
| Shreds | aliens, flies, factories | walls, base cores, enemy tanks |
| Scratches | armour, walls, base cores | the air (half damage) |

**Five waves.** Each brings one game's enemies, and they play the way they do at home:

| Wave | From | The enemy |
|---|---|---|
| 1 | [Swarm Protocol](https://domvirus.com/games/swarm-protocol/) | Bugs walk in from the edges and eat the board's letters into binary. Six letters and they grow; twelve and they hunt you. |
| 2 | [Null Invaders](https://domvirus.com/games/null-invaders/) | Button factories keep releasing drones, crabs and squids that swoop and drop bolts, until the button breaks. |
| 3 | [Sherman Bytes](https://domvirus.com/games/sherman-bytes/) | Tank squads roll out of fortified button bases: four walls round a core with a gun. Wreck the button and the base is yours; park in it to repair. |
| 4 | [Byte Runner](https://domvirus.com/games/byte-runner/) | Flies race food pipes and hop off to chase you (violet straight, pink ahead of you, cyan wherever). A pink power square turns them blue: eat them for 100, 200, 300, 400. |
| 5 | Crossfire | All four at once. |

**DROPS** are your shared reinforcements: four to start, one more for every wave you clear. Go down
with none left and it's INSERT COIN. Your partner always comes back. From Blitz: the blinking power
grid (rapid, triple, shield, health, ammo, airstrike, and mines the plane flies over), supply crates,
airstrikes (F, then the spot), kill streaks (3: a long shot or salvo, 5: an airstrike, 8: a carpet
bomb), auto-aim (Q) and aim lock (T), pause with the white flag, light and dark.

**Controls.** Desktop: WASD / arrows drive or fly, the mouse aims, click or Space fires, E the
special, F airstrike then click the spot, Q auto-aim, T aim lock, Esc or P pause. Phones: the stick
bottom left drives; FIRE, AUTO, LOCK, the special and STRIKE sit bottom right (the grab bar moves them).

## Drop-in options

```html
<!-- A PLAY CROSSFIRE key appears bottom right; your page is the arena -->
<script src="https://crossfire.domvirus.com/dist/dom-crossfire.js" defer></script>
<!-- Drive the tank (the plane is the default) -->
<script src=".../dom-crossfire.js" data-ride="tank" defer></script>
<!-- Hidden: the Konami code on desktop, hold-then-tap a [data-crossfire-trigger] element on phones -->
<script src=".../dom-crossfire.js" data-easter-egg="true" defer></script>
```

Mark anything with `data-crossfire-ignore` to keep it out of the arena. Escape gives the page back
exactly as it was.

## As a module

```js
import { createCrossfire, install } from "./dist/dom-crossfire.mjs";
const game = createCrossfire(document.querySelector("#arena"), { mode: "board" });
game.start(); // the countdown, then wave 1
// { ride: "tank" } picks your ride; { demo: true } is the attract match (both rides AI, no HUD).
```

A second human (instead of the AI partner) plugs in at one seam: `pilot()` in `src/game.ts` is the
one place a ride's controls come from.

## Develop

```sh
npm ci
npm run check          # typecheck, build dist/, size budgets (51,200 B gzip each way)
npm test               # 0 minor GCs in 20,000 steps; a seed replays its match; each army's rules
npm run test:settle    # the match keeps pace, pause holds, the hero rests off screen, quiet after the drop-in
npm run test:browser   # landing, start screen, a match, pause, a win, the drop-in; phones (game mode)
npm run play           # the site on localhost (index.html and play/)
```

The site is static: `index.html` (the landing), `play/index.html` (the game page) and `dist/`
(built in CI: the game, the drop-in, `site.css` from `site/site.css` on the Board UI kit, `page.js`
from `site/page.js`, the pixel art from `src/art.ts`). The Pages workflow publishes them to
crossfire.domvirus.com.

`src/game.ts` is the game (Blitz's `game.ts` reshaped: the crew, the four armies, the waves);
`src/art.ts` is the cast as pixel data. `vendor/fizlet` is a committed snapshot of Fizlet's source
at the `@fzlt/core` 0.21.2 release (tag `v0.21.2`), with its provenance in `vendor/fizlet/ORIGIN.json`.
Never edit it by hand: check out that tag of [coded-dot-design/fizlet](https://github.com/coded-dot-design/fizlet)
next to this repo (or set `FIZLET_DIR`) and run `npm run sync`.
