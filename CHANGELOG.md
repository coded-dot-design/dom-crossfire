# Changelog

## Unreleased

- Layout: the HUD, the arena and the channel bar never cover the page. While playing, the page
  gets the HUD's height on top and the arena (with its channel bar) a block of its own after the
  H1; on phones the block runs to the screen's bottom so the stick and fire sit on it, not on the
  copy. The channel banner rides inside the arena. Recall takes both back and scrolls to where
  PLAY was pressed. Gameplay unchanged; the bundle is 1.3 KB gzip smaller (the game reads only the
  palette from the kit's tokens). Browser check at 1440, 390 and 360; screens in `docs/screens/`.

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
