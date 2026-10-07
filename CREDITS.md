# Credits and licenses

| Asset | Source | License / terms |
| --- | --- | --- |
| Ships, ship parts, effects, tiles (`assets/spritesheet/ships_miscellaneous_sheet*`, `assets/tilesheet/*`, `assets/png/*/{ships,ship_parts,effects,tiles}`, `assets/vector/*`) | Supplied with the challenge. The sheets match Kenney's [Pirate Pack](https://kenney.nl/assets/pirate-pack). | Kenney assets are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). |
| UI atlas "Pirate Battle UI asset pack" (`assets/spritesheet/ui_sheet*`, `assets/png/*/ui`) | Supplied with the challenge by Jungle Gaming. | Used as provided, for this challenge only. |
| Sound effects and ambience loops (`assets/sounds/*.wav`) | Supplied with the challenge by Jungle Gaming. | Used as provided, for this challenge only. |
| Jungle Gaming logo and reference screenshots (`assets/logo_jungle_gaming.svg`, `assets/*.png`) | Supplied with the challenge by Jungle Gaming. | Used as provided, for this challenge only. |

## How the assets are used

- No asset was modified, converted or re-exported. The ships atlas is a Starling/Sparrow XML file; it is
  parsed at runtime into the TexturePacker JSON format PixiJS expects (`src/game/assets.ts`). The tile
  sheet has no atlas file, so its 16 x 6 grid of 64 px tiles is described in code.
- Retina variants (`*_retina`) are used on screens with a device pixel ratio of 1.5 or more.
- Only files referenced by the code end up in the build (Vite asset imports), so the reference
  screenshots and vector sources are not deployed.

## Fonts

None. The UI uses the system font stack (`Trebuchet MS`, `Segoe UI`, `system-ui`).

## Libraries

React, PixiJS, TanStack Query, Axios and MSW are MIT licensed. See `package.json` and `package-lock.json`
for exact versions.
