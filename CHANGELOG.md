# Changelog

## 0.4.0

- **Squad play, 2 to 4 people** (`/play/squad/`), co-op only. Each person picks the plane or the
  tank; mixed squads are fine. A squad of two keeps the AI partner (it takes the ride the two have
  fewer of); three or four play without it. Shared DROPS; no pause in a squad match.
- Battlefield Blitz's net play: lockstep over `@fzlt/core/presence` from the room's seed, one 32-bit
  input word per person per frame (the ride rides in bit 9 through the countdown), a fixed 1100 × 640
  arena scaled to fit, the match hash compared every 30 frames. Blitz's room card (invite code, your
  ride, room; four seats; P1's START NOW with two or three in; the squad's rides and kills; someone
  left). The room server is the same one Blitz uses; Crossfire's rooms are its 8 to 15.
- A new build, `dist/dom-crossfire-net.mjs` (the module plus squad play): 55,191 B gzip, budget
  55,424 B. The solo builds carry the seats, the input word and the hash (+1.5 KB, as Blitz's do).
- Tests: `test:lockstep` (2, 3 and 4 people identical frame for frame, a slow jittered link plays
  the very same match, the same seed replays it, 0 desyncs, 0 Math.random) and `tests/squad.mjs`
  (four browsers join one room through the squad page on a stand-in room server and play in lockstep;
  two with START NOW keep the AI partner). CI runs both.

## 0.3.0

- **Four waves a section.** Each army is now a section of four waves: more of them each wave, faster
  (their speed and fire rate climb with the wave), tougher (grown bugs, sturdier factories and
  cores), and a mini-boss on the fourth: the queen bug, the mothership (fans of three bolts), the
  heavy tank (three shells a shot), the big frog. Then the finale: all four armies at once (17
  waves in all). The HUD and the wave cards say "SECTION 2 · WAVE 3/4", or "FINALE".
- **DROPS:** one more for each section cleared, not each wave (17 waves of drops made losing rare).
- **Byte Runner, flipped:** no food pipes. Every Byte Runner character is a bad guy, the frog too.
  The pellets sit on the board's blocks and are their food (eaten ones come back on another block):
  a fly that eats one gets a tier (one more HP, faster, bigger, a pip), up to three. The frog grows
  with every pellet; at four it's big enough to eat a ride: it stops, its tongue marks the ride's
  spot for 0.9 s (a blinking dashed line and closing brackets), then strikes, and a plane or tank
  still on the spot is eaten whole (an instant down; a shield saves you). Small frogs only bite.
  The pink power squares (eat the flies) are gone.
- The landing's Byte Runner card, the rules cards, the README and the rules test follow.

## 0.2.1

- Click to fire on desktop: a held mouse button on the field fires from the moment you land, with
  either ride. The 0.6 s gun cooldown a ride used to land with is gone, so it no longer swallows a
  held click (Space already worked once it ran out); the landing shield still covers you.
- The scoreboard no longer takes the pointer (`pointer-events: none`; it has no keys of its own), so
  a click under it, mid-field, reaches the game. It no longer drags, either.
- Browser test: a held click on the field fires, and a click under the scoreboard reaches the
  field, for both rides.
- The step's effects (blasts, words, puffs) and damage now go through the step's registers, and the
  rides' part of the step is split into small functions, so it stays at 0 minor GCs in 20,000 steps
  as the match changes (CI's Chrome 145 had counted 3 with the first version of this fix).
- Size: 50,748 B gzip (drop-in), 50,794 B (module).

## 0.2.0

v2: started over on Battlefield Blitz (pending owner review).

- **The game:** a co-op mashup built on Battlefield Blitz 1.0.1: its engine setup on `@fzlt/core`
  bricks, the Board UI, the HUD, the start screen, the phone layout, pause and the white flag, the
  blasts, airstrikes, power tiles, crates and sound. Pick the PLANE (Null Invaders' interceptor:
  fast, flies over cover, guns that tier up to Overdrive, a homing SALVO) or the TANK (Blitz's
  tank: armour, a cannon that overheats, the LONG shot); the other is your AI partner.
- **The enemies:** five waves of the first four DOM VIRUS games' bad guys. Swarm Protocol's bugs eat
  the board's letters into binary and grow (6, then 12: a hunter); Null Invaders' button factories
  release drones, crabs and squids until they break; Sherman Bytes' squads roll out of fortified
  button bases (four walls, a core with a gun; take it and it repairs you); Byte Runner's flies race
  food pipes, and a power square turns them blue to eat. Wave five is all four.
- **Strengths:** the plane shreds the air and the factories and barely scratches armour or walls;
  the tank breaches walls, wrecks tanks and squashes small bugs, and does half damage to the air.
- **DROPS:** shared reinforcements, four to start and one per wave cleared.
- **The site:** a new landing in Blitz's landing's style (a live co-op battle in the hero, how it
  plays, the four armies, plane or tank, controls, put it on your site, the family) and a play page
  with Blitz's phone game mode. The Pages workflow also publishes `play/`.
- **Gates:** 0 minor GCs in 20,000 steps (attract and board), replay determinism, each army's
  rules, the settle guard (the hero rests off screen), the browser test and the phone test (390×844,
  844×390). Size: 50,646 B gzip (drop-in), 50,672 B (module); the first cut was 39,980 / 39,773 B.

## Unreleased (first cut, superseded by 0.2.0)

- Layout: the HUD, the arena and the channel bar never cover the page. While playing, the page
  gets the HUD's height on top and the arena (with its channel bar) a block of its own after the
  H1; on phones the block runs to the screen's bottom so the stick and fire sit on it, not on the
  copy. The channel banner rides inside the arena. Recall takes both back and scrolls to where
  PLAY was pressed. Gameplay unchanged; the bundle is 1.3 KB gzip smaller (the game reads only the
  palette from the kit's tokens). Browser check at 1440, 390 and 360 (its screens left `docs/` with 0.2.0).

## 0.1.0

- First cut. "The virus scrambled the cartridges": one arena, one score, and every 30 seconds the
  rules channel-surf between five DOM VIRUS cartridges: Null Invaders, Byte Runner, Sherman Bytes,
  Swarm Protocol and DOM Battlefield. CH1 first, the rest in a seeded order; a 150 s round.
- The glitch between channels (CRT tear, colour bars, static, a surfing channel number), a TV OSD,
  the channel guide, the Board UI banner and cues. Reduced motion gets a still card.
- Built on Fizlet: `vendor/fizlet` is the `@fzlt/core` 0.21.2 release (tag `v0.21.2`).
- Gates: check (typecheck, build, size budget 41,691 B gzip), deterministic replay and zero
  allocation in the sim step (the warm-up puts every cartridge on air before it counts), the
  settle guard and the browser smoke test.
