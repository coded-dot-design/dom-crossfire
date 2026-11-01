# Contributing

Pull requests welcome. Before you open one, run `npm ci`, then `npm run check`, `npm test`,
`npm run test:settle` and `npm run test:browser`, and keep them green:

- the size budget: 41,691 bytes gzip for each build in `dist/`;
- no runtime dependencies (dev tools only);
- no allocation in a sim step (`npm test`: 0 young GCs), and the same seed gives the same match;
- `vendor/fizlet` is a synced snapshot: never edit it by hand (see the README).

Art is original: characters are drawn as data in `src/rules.ts`. Please don't add art, names or
likenesses from other games or real people.
