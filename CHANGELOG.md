# Changelog

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
  844×390). Size: 50,609 B gzip (drop-in), 50,636 B (module); the first cut was 39,980 / 39,773 B.

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
