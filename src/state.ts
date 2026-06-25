export type Mode = 'paint' | 'region' | 'orbit'
export type SelectMode = 'segment' | 'flood'

/** Shared, mutable app state driven by the UI panel. */
export interface AppState {
  mode: Mode
  /** Active color (brush + region fill) as a CSS hex string. */
  color: string
  /** Brush radius in world units. */
  brushRadius: number
  /** Brush opacity per stamp, 0..1. */
  strength: number
  /** Brush: skip back-facing vertices (no paint-through on thin walls). */
  frontFacingOnly: boolean
  /** Region fill strategy. */
  regionMode: SelectMode
  /** flood mode: max crease angle (degrees) the flood will cross. */
  regionAngle: number
  /** flood mode: ignore the angle and fill the whole connected shell. */
  wholeShell: boolean
}

export function createState(): AppState
{
  return {
    mode: 'region',
    color: '#e23b2e',
    brushRadius: 6,
    strength: 0.85,
    frontFacingOnly: true,
    regionMode: 'segment',
    regionAngle: 35,
    wholeShell: false,
  }
}
