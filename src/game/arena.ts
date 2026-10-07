// Static arena layout shared by the simulation (colliders) and the renderer (tiles).
// Units are world units; one tile = 64 units. Frames index tiles_sheet.png (16 columns).

export const TILE = 64;
export const ARENA_COLS = 20;
export const ARENA_ROWS = 12;
export const ARENA_WIDTH = ARENA_COLS * TILE;
export const ARENA_HEIGHT = ARENA_ROWS * TILE;

/**
 * Islands reuse the sheet's own blocks (3x3 sand, 4x4 grass): tiling their middle
 * tiles leaves visible seams, so sizes are fixed by style.
 */
export const ISLAND_BLOCKS = {
  sand: { origin: 0, size: 3 },
  grass: { origin: 5, size: 4 },
} as const;

/** Translucent 3x3 shallow-water nine-slice drawn one tile around every island. */
export const SHALLOW_ORIGIN = 9;

export interface Decor {
  frame: number;
  /** Offset from the island's top-left corner, in tiles. */
  dx: number;
  dy: number;
}

export interface Island {
  col: number;
  row: number;
  style: keyof typeof ISLAND_BLOCKS;
  decor: Decor[];
}

export interface Rock {
  frame: number;
  x: number;
  y: number;
  radius: number;
}

export const ISLANDS: Island[] = [
  { col: 2, row: 1, style: 'grass', decor: [{ frame: 70, dx: 1.5, dy: 1.4 }, { frame: 71, dx: 2.6, dy: 2.5 }, { frame: 86, dx: 1.3, dy: 2.6 }] },
  { col: 8, row: 1, style: 'sand', decor: [{ frame: 49, dx: 1.5, dy: 1.4 }] },
  { col: 15, row: 1, style: 'sand', decor: [{ frame: 66, dx: 1.7, dy: 1.6 }, { frame: 87, dx: 1, dy: 1 }] },
  { col: 1, row: 8, style: 'sand', decor: [{ frame: 69, dx: 1.5, dy: 1.5 }] },
  { col: 6, row: 8, style: 'sand', decor: [{ frame: 48, dx: 1.2, dy: 1.7 }, { frame: 86, dx: 1.9, dy: 1.1 }] },
  { col: 14, row: 6, style: 'grass', decor: [{ frame: 12, dx: 1.5, dy: 1.5 }, { frame: 69, dx: 2.6, dy: 2.6 }, { frame: 87, dx: 2.5, dy: 1.3 }] },
];

export const ROCKS: Rock[] = [
  { frame: 50, x: 800, y: 330, radius: 19 },
  { frame: 49, x: 255, y: 420, radius: 23 },
];

export const PLAYER_START = { x: 640, y: 400, angle: -Math.PI / 2 };

// Islands collide as rounded rectangles that hug the wavy sand edges.
const ISLAND_INSET = 4;
const ISLAND_CORNER = 34;

export const ISLAND_COLLIDERS = ISLANDS.map((i) => {
  const size = ISLAND_BLOCKS[i.style].size;
  return {
    cx: (i.col + size / 2) * TILE,
    cy: (i.row + size / 2) * TILE,
    hw: (size * TILE) / 2 - ISLAND_INSET,
    hh: (size * TILE) / 2 - ISLAND_INSET,
    r: ISLAND_CORNER,
  };
});

/** Signed distance to the nearest obstacle (negative = inside an island or rock). */
export function obstacleDistance(x: number, y: number): number {
  let d = Infinity;
  for (const o of ISLAND_COLLIDERS) {
    const qx = Math.abs(x - o.cx) - o.hw + o.r;
    const qy = Math.abs(y - o.cy) - o.hh + o.r;
    const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - o.r;
    if (dist < d) d = dist;
  }
  for (const r of ROCKS) {
    const dist = Math.hypot(x - r.x, y - r.y) - r.radius;
    if (dist < d) d = dist;
  }
  return d;
}

export function insideArena(x: number, y: number, margin = 0): boolean {
  return x >= margin && y >= margin && x <= ARENA_WIDTH - margin && y <= ARENA_HEIGHT - margin;
}
