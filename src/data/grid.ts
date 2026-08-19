/**
 * Board layout constants.
 *
 * Ring expansion is the progression curve: the player starts cramped on rings
 * 1-2 and unlocks outward, so early placement decisions stay meaningful.
 */

export const HEX_SIZE = 1

/** Gap between neighbouring tiles, as a fraction of tile radius. */
export const TILE_INSET = 0.94

/**
 * Radius of the largest circle that fits inside a drawn tile — half its
 * flat-to-flat width.
 *
 * Constructs are yawed to face outward, so their footprint rotates within the
 * hex. The inscribed circle is therefore the bound that holds at every angle.
 */
export const TILE_INNER_RADIUS = (HEX_SIZE * TILE_INSET * Math.sqrt(3)) / 2

/** Outermost buildable ring at full expansion. Ring BOARD_RADIUS+1 is the enemy approach. */
export const BOARD_RADIUS = 4

export const enum CellState {
  /** Ring 0. Holds the Eldree. Never buildable. */
  Eldree,
  /** Unlocked and empty. */
  Open,
  /** Inside the board but not yet unlocked at the current wave. */
  Locked,
}

/** Wave at which each ring becomes buildable. Index = ring number. */
export const RING_UNLOCK_WAVE: readonly number[] = [0, 1, 1, 4, 8]

export interface RingStyle {
  readonly top: number
  readonly side: number
  /** Tile top surface height in world units. Subtle stepping reads as terrain. */
  readonly elevation: number
}

/** Per-ring tile colours, innermost first. Locked rings are not drawn at all. */
export const RING_STYLES: readonly RingStyle[] = [
  { top: 0x3f6b4a, side: 0x24402c, elevation: 0.34 },
  { top: 0x53794f, side: 0x2c4630, elevation: 0.26 },
  { top: 0x4c7150, side: 0x293f2c, elevation: 0.2 },
  { top: 0x456851, side: 0x243a2b, elevation: 0.14 },
  { top: 0x3d5c4c, side: 0x1f3227, elevation: 0.08 },
]
