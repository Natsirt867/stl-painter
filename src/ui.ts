import GUI from 'lil-gui'
import * as THREE from 'three'
import type { AppState, Mode, SelectMode } from './state'
import type { BrushPainter } from './painter'
import type { RegionTool } from './regions'
import { exportPLY } from './exporters/ply'
import { export3MF } from './exporters/threemf'
import { downloadBlob } from './download'

export interface UIOptions {
  state: AppState
  painter: BrushPainter
  region: RegionTool
  geometry: THREE.BufferGeometry
  /** Largest radius the brush slider should allow (sized to the model). */
  maxBrush: number
  onModeChange: (mode: Mode) => void
  onUndo: () => void
  onRedo: () => void
}

export function buildUI(opts: UIOptions): GUI
{
  const { state, painter, region, geometry, maxBrush, onModeChange, onUndo, onRedo } = opts
  const gui = new GUI({ title: 'STL Painter — Demo' })

  gui
    .add(state, 'mode', { Paint: 'paint', 'Region fill': 'region', Orbit: 'orbit' })
    .name('Mode')
    .onChange((m: Mode) => onModeChange(m))

  gui
    .addColor(state, 'color')
    .name('Color')
    .onChange((hex: string) => painter.color.set(hex))

  const edit = gui.addFolder('Edit')
  edit.add({ undo: onUndo }, 'undo').name('Undo  (Ctrl+Z)')
  edit.add({ redo: onRedo }, 'redo').name('Redo  (Ctrl+Y)')

  const brush = gui.addFolder('Brush')
  brush
    .add(state, 'brushRadius', maxBrush * 0.01, maxBrush)
    .name('Size')
    .onChange((v: number) => (painter.radius = v))
  brush
    .add(state, 'strength', 0.05, 1, 0.05)
    .name('Strength')
    .onChange((v: number) => (painter.strength = v))
  brush
    .add(state, 'frontFacingOnly')
    .name('Front faces only')
    .onChange((v: boolean) => (painter.frontFacingOnly = v))

  const reg = gui.addFolder('Region fill')
  reg
    .add(state, 'regionMode', { 'Segment (scroll to size)': 'segment', 'Crease flood': 'flood' })
    .name('Select by')
    .onChange((v: SelectMode) => (region.selectMode = v))
  reg
    .add(state, 'regionAngle', 5, 90, 1)
    .name('Flood angle°')
    .onChange((v: number) => (region.angleThreshold = v))
  reg
    .add(state, 'wholeShell')
    .name('Whole shell')
    .onChange((v: boolean) => (region.wholeShell = v))

  const exp = gui.addFolder('Export')
  exp
    .add({ mf: () => downloadBlob(export3MF(geometry), 'painted.3mf') }, 'mf')
    .name('.3mf  (for slicing)')
  exp
    .add({ ply: () => downloadBlob(exportPLY(geometry), 'painted.ply') }, 'ply')
    .name('.ply  (vertex colors)')

  return gui
}
