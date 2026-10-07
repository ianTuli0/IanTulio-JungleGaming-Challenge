import { Assets, Spritesheet, type SpritesheetData, type Texture } from 'pixi.js';
import { createStore } from '../store.ts';
import shipsXml from '../../assets/spritesheet/ships_miscellaneous_sheet.xml?raw';
import shipsPng from '../../assets/spritesheet/ships_miscellaneous_sheet.png';
import uiJson from '../../assets/spritesheet/ui_sheet.json';
import uiPng from '../../assets/spritesheet/ui_sheet.png';
import uiRetinaJson from '../../assets/spritesheet/ui_sheet_retina.json';
import uiRetinaPng from '../../assets/spritesheet/ui_sheet_retina.png';
import tilesPng from '../../assets/tilesheet/tiles_sheet.png';
import tilesRetinaPng from '../../assets/tilesheet/tiles_sheet_retina.png';
import waterPng from '../../assets/png/default/tiles/tile_73.png';
import waterRetinaPng from '../../assets/png/retina/tiles/tile_73.png';

export interface GameAssets {
  tiles: Spritesheet;
  ships: Spritesheet;
  ui: Spritesheet;
  water: Texture;
  /** `ui.layout.fill_rect` from the atlas metadata, in logical pixels. */
  enemyBarFill: { x: number; y: number; w: number; h: number };
}

export type AssetStatus =
  | { status: 'idle' | 'ready'; progress: number }
  | { status: 'loading'; progress: number }
  | { status: 'error'; progress: number; message: string };

export const assetStatus = createStore<AssetStatus>({ status: 'idle', progress: 0 });

/** Ships atlas ships as Starling XML; Pixi wants TexturePacker JSON. */
function parseStarlingXml(xml: string): SpritesheetData {
  const frames: SpritesheetData['frames'] = {};
  for (const [, name, x, y, w, h] of xml.matchAll(/name="([^"]+)\.png" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)) {
    frames[name] = { frame: { x: +x, y: +y, w: +w, h: +h } };
  }
  return { frames, meta: { scale: 1 } };
}

/** tiles_sheet.png is a plain 16x6 grid; frame names are the grid index. */
function gridData(scale: number): SpritesheetData {
  const size = 64 * scale;
  const frames: SpritesheetData['frames'] = {};
  for (let i = 0; i < 96; i++) frames[i] = { frame: { x: (i % 16) * size, y: Math.floor(i / 16) * size, w: size, h: size } };
  return { frames, meta: { scale } };
}

async function load(onProgress: (p: number) => void): Promise<GameAssets> {
  // High-density screens get the 2x atlases; Spritesheet keeps logical sizes identical.
  const hd = window.devicePixelRatio >= 1.5;
  const [tilesUrl, waterUrl, uiUrl] = hd ? [tilesRetinaPng, waterRetinaPng, uiRetinaPng] : [tilesPng, waterPng, uiPng];
  const textures = await Assets.load<Texture>([tilesUrl, waterUrl, uiUrl, shipsPng], onProgress);
  const uiData = hd ? uiRetinaJson : uiJson;
  const sheets = [
    new Spritesheet(textures[tilesUrl], gridData(hd ? 2 : 1)),
    new Spritesheet(textures[shipsPng], parseStarlingXml(shipsXml)),
    new Spritesheet(textures[uiUrl], uiData as SpritesheetData),
  ];
  await Promise.all(sheets.map((s) => s.parse()));
  const [tiles, ships, ui] = sheets;
  return { tiles, ships, ui, water: textures[waterUrl], enemyBarFill: uiData.frames.enemy_health_fill_red.ui.layout.fill_rect };
}

let pending: Promise<GameAssets> | null = null;

/** Loads once and reuses the textures for every match; a failure clears the cache so Retry works. */
export function loadGameAssets(): Promise<GameAssets> {
  pending ??= load((progress) => assetStatus.set({ status: 'loading', progress }))
    .then((assets) => {
      assetStatus.set({ status: 'ready', progress: 1 });
      return assets;
    })
    .catch((error: unknown) => {
      pending = null;
      assetStatus.set({ status: 'error', progress: 0, message: error instanceof Error ? error.message : String(error) });
      throw error;
    });
  if (assetStatus.get().status !== 'ready') assetStatus.set({ status: 'loading', progress: assetStatus.get().progress });
  return pending;
}
