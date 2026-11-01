# Changelog

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
