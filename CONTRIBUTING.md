# Contributing

Pull requests welcome. Before you open one, run `npm ci`, then `npm run check`, `npm test`,
`npm run test:settle` and `npm run test:browser`, and keep them green:

- the size budgets in `scripts/size.mjs` (53,760 bytes gzip for each solo build of the game, 55,424 for the squad build);
- no runtime dependencies (dev tools only);
- no allocation in a step (`npm test`: 0 minor GCs in 20,000 steps), and the same seed gives the same match;
- `vendor/fizlet` is a synced snapshot: never edit it by hand (see the README).

Art is original or from the DOM VIRUS games by the same author, drawn as data in `src/art.ts`.
Please don't add art, names or likenesses from other games or real people.
