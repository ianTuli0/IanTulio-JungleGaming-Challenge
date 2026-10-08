// Arena layout shared by the simulation (colliders) and the renderer (tiles).
// Units are world units; one tile = 64 units. Tile frames index tiles_sheet.png (16 columns).

export const TILE = 64;
/** The designed layout. A match's bounds grow around it to match the screen's shape. */
export const ARENA_WIDTH = 20 * TILE;
export const ARENA_HEIGHT = 12 * TILE;

/** Navigable rectangle of one match, in world units (may start below 0). */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Bounds filling a screen of this aspect ratio: the 1280 x 768 layout stays centred and open sea is
 * added on the sides (wide screens) or above and below (tall ones). Extreme shapes are capped.
 */
export function arenaBounds(aspect: number): Bounds {
  const a = Math.min(Math.max(aspect, 4 / 3), 2.4);
  const ox = (Math.max(ARENA_WIDTH, ARENA_HEIGHT * a) - ARENA_WIDTH) / 2;
  const oy = (Math.max(ARENA_HEIGHT, ARENA_WIDTH / a) - ARENA_HEIGHT) / 2;
  return { x0: -ox, y0: -oy, x1: ARENA_WIDTH + ox, y1: ARENA_HEIGHT + oy };
}

export const DEFAULT_BOUNDS = arenaBounds(ARENA_WIDTH / ARENA_HEIGHT);

/** The sheet's 3x3 sand island, its plain centre tile, and the translucent 3x3 shallow-water block. */
export const SAND_ORIGIN = 0;
export const SAND_CENTRE = 17;
export const SHALLOW_ORIGIN = 9;
const SAND_SIZE = 3 * TILE;

/**
 * A blob is the whole sand block stretched over w x h (repeating its tiles leaves seams). Several
 * overlapping blobs make one irregular island.
 */
export interface Blob {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Visual-only props: `tile` frames come from the tile sheet, `ship` frames from the ships sheet. */
export interface Decor {
  tile?: number;
  ship?: string;
  x: number;
  y: number;
  rot?: number;
  scale?: number;
}

/** Central island: a lopsided cross (top arm to the right, long left arm, bottom arm to the left). */
export const CENTRAL: Blob[] = [
  { x: 580, y: 100, w: 248, h: 184 }, // top arm
  { x: 388, y: 168, w: 332, h: 244 }, // band, left half
  { x: 608, y: 160, w: 284, h: 248 }, // band, right half
  { x: 452, y: 296, w: 248, h: 180 }, // bottom arm
];

export const CENTRAL_DECOR: Decor[] = [
  { tile: 70, x: 704, y: 222 },
  { tile: 87, x: 520, y: 290 },
  { ship: 'cannon_mobile', x: 640, y: 290, rot: Math.PI },
  { tile: 49, x: 768, y: 290 },
  { tile: 71, x: 576, y: 354, scale: 0.8 },
  { tile: 59, x: 800, y: 480 }, // planks of the jetty, between its two stone ends
];

/** Peripheral islands: they surface at one of the islandSpots and move every ISLAND_SHIFT_SECONDS. */
export interface Peripheral {
  w: number;
  h: number;
  /** Index into islandSpots() at the start of a match. */
  slot: number;
  /** Relative to the island's top-left corner. */
  decor: Decor[];
}

export const PERIPHERALS: Peripheral[] = [
  {
    w: 192,
    h: 128,
    slot: 1,
    decor: [
      { tile: 49, x: 60, y: 60 },
      { tile: 87, x: 108, y: 78 },
      { ship: 'dinghy_small_1', x: 150, y: 56, rot: 0.6 },
    ],
  },
  {
    w: 144,
    h: 144,
    slot: 2,
    decor: [
      { tile: 69, x: 56, y: 56, scale: 0.8 },
      { ship: 'cannon_loose', x: 96, y: 98, rot: -0.4, scale: 0.9 },
    ],
  },
];

export const ISLAND_SHIFT_SECONDS = 30;

/** Centres of the spots along the border where peripheral islands surface: corners and side middles. */
export function islandSpots({ x0, y0, x1, y1 }: Bounds): { x: number; y: number }[] {
  const [left, right, top, bottom, middle] = [x0 + 160, x1 - 160, y0 + 136, y1 - 136, (y0 + y1) / 2];
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: left, y: middle },
    { x: right, y: middle },
  ];
}

export function peripheralBlob(island: number, spot: { x: number; y: number }): Blob {
  const { w, h } = PERIPHERALS[island];
  return { x: spot.x - w / 2, y: spot.y - h / 2, w, h };
}

/**
 * Walls following the cross, one entry per tile (0 = empty): 76/77/92/93 corner towers, 15/14
 * straight walls, 46/47 and 31/30 walls carrying a cannon (pointing outwards), 62/78 the rounded
 * stone ends of the jetty.
 */
const FORT = { x: 416, y: 128 };
const FORT_ROWS = [
  [0, 0, 0, 76, 46, 77, 0],
  [76, 15, 15, 93, 0, 92, 77],
  [31, 0, 0, 0, 0, 0, 30],
  [92, 77, 0, 76, 15, 47, 93],
  [0, 92, 47, 93, 0, 0, 0],
];
const JETTY = [
  { frame: 62, x: 768, y: 384 },
  { frame: 78, x: 768, y: 512 },
];
const VERTICAL = [14, 30, 31, 62, 78];
const HORIZONTAL = [15, 46, 47];

export interface Wall {
  frame: number;
  /** Tile top-left, world units. */
  x: number;
  y: number;
  /** Frame shown once a ball breaks it; null for towers, which never break. */
  broken: number | null;
  /** Stone area that stops balls. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const tiles = [
  ...FORT_ROWS.flatMap((row, j) => row.map((frame, i) => ({ frame, x: FORT.x + i * TILE, y: FORT.y + j * TILE }))),
  ...JETTY,
];

export const WALLS: Wall[] = tiles.flatMap(({ frame, x, y }): Wall[] => {
  if (!frame) return [];
  const alt = Math.round((x + y) / TILE) % 2 === 0; // alternate the two broken variants
  if (VERTICAL.includes(frame)) return [{ frame, x, y, broken: alt ? 88 : 90, x0: x + 10, y0: y, x1: x + 54, y1: y + TILE }];
  if (HORIZONTAL.includes(frame)) return [{ frame, x, y, broken: alt ? 89 : 91, x0: x, y0: y + 10, x1: x + TILE, y1: y + 54 }];
  return [{ frame, x, y, broken: null, x0: x + 6, y0: y + 6, x1: x + 58, y1: y + 58 }];
});

export const PLAYER_START = { x: 640, y: 680, angle: -Math.PI / 2 };

/** Rounded rectangle (centre, half extents, corner radius). Ships only: balls fly over islands. */
export interface Collider {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  r: number;
}

/** Hugs the wavy shore of the stretched sand block. */
export function blobCollider({ x, y, w, h }: Blob): Collider {
  const sx = w / SAND_SIZE;
  const sy = h / SAND_SIZE;
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2 - 4 * sx, hh: h / 2 - 4 * sy, r: 34 * Math.min(sx, sy) };
}

const FIXED_COLLIDERS: Collider[] = [...CENTRAL.map(blobCollider), { cx: 800, cy: 480, hw: 24, hh: 84, r: 20 }]; // + jetty

/** Every island collider, with the peripheral islands at the given blobs. */
export function islandColliders(peripherals: readonly Blob[]): Collider[] {
  return [...FIXED_COLLIDERS, ...peripherals.map(blobCollider)];
}

/** Signed distance to one rounded rectangle (negative = inside). */
export function colliderDistance(o: Collider, x: number, y: number): number {
  const qx = Math.abs(x - o.cx) - o.hw + o.r;
  const qy = Math.abs(y - o.cy) - o.hh + o.r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - o.r;
}

/** Signed distance to the nearest island (negative = on land). */
export function obstacleDistance(colliders: readonly Collider[], x: number, y: number): number {
  let d = Infinity;
  for (const o of colliders) d = Math.min(d, colliderDistance(o, x, y));
  return d;
}

export function insideArena(b: Bounds, x: number, y: number, margin = 0): boolean {
  return x >= b.x0 + margin && y >= b.y0 + margin && x <= b.x1 - margin && y <= b.y1 - margin;
}
