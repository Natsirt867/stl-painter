import * as THREE from 'three'
import { createScene, frameObject } from './scene'
import { loadModel, buildFromSTL, buildFromPLY, type LoadedModel } from './loader'
import { BrushPainter } from './painter'
import { RegionTool } from './regions'
import { ColorHistory } from './history'
import { Highlighter } from './highlighter'
import { createState, type Mode } from './state'
import { buildUI } from './ui'

const canvas = document.getElementById('app') as HTMLCanvasElement
const hud = document.getElementById('hud') as HTMLDivElement
const overlay = document.getElementById('overlay') as HTMLDivElement

const ctx = createScene(canvas)
const state = createState()

const MODEL_URL = `${import.meta.env.BASE_URL}models/orc.stl`

let painter: BrushPainter | null = null
let region: RegionTool | null = null
let history: ColorHistory | null = null
let highlighter: Highlighter | null = null

// --- pointer → paint/fill wiring --------------------------------------------
const ndc = new THREE.Vector2()
const hoverNdc = new THREE.Vector2()
let painting = false
let regionPainting = false
let hoverDirty = false
let lastHoverFaces: number[] | null = null
let lastFilledFaces: number[] | null = null

function clearHover(): void
{
  highlighter?.clear()
  lastHoverFaces = null
}

// Fill the segment under the current `ndc`, skipping if it's the same segment
// we just filled (so a drag sweeps across parts without redundant work).
function fillRegionAt(): void
{
  if (!region || !painter) return
  const face = region.pickFace(ndc, ctx.camera)
  if (face == null) return
  const faces = region.select(face)
  if (faces === lastFilledFaces) return
  lastFilledFaces = faces
  region.applyColor(faces, painter.color)
}

function toNdc(e: PointerEvent): void
{
  const rect = canvas.getBoundingClientRect()
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

canvas.addEventListener('pointerdown', (e) =>
{
  if (e.button !== 0) return
  if (e.shiftKey) return // Shift+left-drag is the free-move (orbit) override

  if (painter && state.mode === 'paint')
  {
    painting = true
    canvas.setPointerCapture(e.pointerId)
    history?.begin()
    toNdc(e)
    painter.strokeAt(ndc, ctx.camera)
  }
  else if (region && state.mode === 'region')
  {
    // Drag-to-fill: a stroke can sweep across many crease-bounded segments, so
    // small parts (fingers) fill precisely without ever going coarse.
    regionPainting = true
    canvas.setPointerCapture(e.pointerId)
    history?.begin()
    lastFilledFaces = null
    clearHover()
    toNdc(e)
    fillRegionAt()
  }
})

canvas.addEventListener('pointermove', (e) =>
{
  if (painting && painter)
  {
    toNdc(e)
    painter.strokeAt(ndc, ctx.camera)
    return
  }
  if (regionPainting)
  {
    toNdc(e)
    fillRegionAt()
    return
  }
  // Region hover preview: remember the cursor; the highlight updates in the loop.
  if (state.mode === 'region')
  {
    const rect = canvas.getBoundingClientRect()
    hoverNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    hoverNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    hoverDirty = true
  }
})

function endStroke(e: PointerEvent): void
{
  if (!painting && !regionPainting) return
  painting = false
  regionPainting = false
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
}
canvas.addEventListener('pointerup', endStroke)
canvas.addEventListener('pointercancel', endStroke)
canvas.addEventListener('pointerleave', () =>
{
  if (state.mode === 'region') clearHover()
})

// Shift+scroll grows/shrinks the segment selection; plain scroll still zooms.
// Capture phase + stopPropagation intercepts it before OrbitControls.
canvas.addEventListener(
  'wheel',
  (e) =>
  {
    if (!e.shiftKey) return // plain wheel → let OrbitControls zoom
    if (state.mode !== 'region' || state.regionMode !== 'segment' || !region) return
    e.preventDefault()
    e.stopPropagation()
    if (e.deltaY < 0) region.growSelection()
    else region.shrinkSelection()
    hoverDirty = true
    updateHud()
  },
  { capture: true, passive: false },
)

// Undo/redo keyboard shortcuts.
window.addEventListener('keydown', (e) =>
{
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) { if (history?.undo()) e.preventDefault() }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { if (history?.redo()) e.preventDefault() }
})

// Hold Shift to free-move (orbit) with left-drag even while a tool owns the
// left button. Releasing Shift restores the tool's left-click.
function setLeftOrbit(on: boolean): void
{
  if (state.mode === 'orbit') return
  ;(ctx.controls.mouseButtons as any).LEFT = on ? THREE.MOUSE.ROTATE : null
}
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') setLeftOrbit(true) })
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') setLeftOrbit(false) })
window.addEventListener('blur', () => setLeftOrbit(false))

// In paint/region modes the left button acts on the surface, so orbit moves to
// right-drag. In orbit mode left-drag orbits as usual.
function applyMode(mode: Mode): void
{
  if (mode === 'paint' || mode === 'region')
  {
    // LEFT: null disables orbit's left-button so the tool owns left-click/drag.
    ctx.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    } as any
  }
  else
  {
    ctx.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    } as any
  }
  if (mode !== 'region') clearHover()
  updateHud()
}

function updateHud(): void
{
  let hint: string
  if (state.mode === 'paint')
  {
    hint = 'left-drag to paint · shift- or right-drag to orbit'
  }
  else if (state.mode === 'region')
  {
    if (state.regionMode === 'segment' && region)
    {
      hint =
        `drag to fill · shift+scroll to size ` +
        `(${region.levelIndex + 1}/${region.levelCount}, ~${region.levelAngle}°) · shift- or right-drag to orbit`
    }
    else hint = 'drag to fill · shift- or right-drag to orbit'
  }
  else hint = 'left-drag to orbit'
  hud.innerHTML =
    `<b>STL Painter — demo</b><br>` +
    `${modelInfo}<br>` +
    `mode: <b>${state.mode}</b> · ${hint}<br>` +
    `<span style="opacity:0.6">drag &amp; drop a .stl or .ply anywhere to load</span>`
}

let modelInfo = ''
let gui: ReturnType<typeof buildUI> | null = null
let currentMesh: THREE.Mesh | null = null

// Swap in a model: tear down the previous mesh + tools, then wire up new ones.
function installModel(model: LoadedModel, label: string): void
{
  if (currentMesh)
  {
    ctx.scene.remove(currentMesh)
    ;(currentMesh.geometry as any).disposeBoundsTree?.()
    currentMesh.geometry.dispose()
    ;(currentMesh.material as THREE.Material).dispose()
  }
  gui?.destroy()
  clearHover()
  painting = false
  regionPainting = false
  lastFilledFaces = null

  currentMesh = model.mesh
  ctx.scene.add(model.mesh)
  frameObject(ctx, model.mesh)

  model.geometry.computeBoundingSphere()
  const modelRadius = model.geometry.boundingSphere!.radius
  state.brushRadius = modelRadius * 0.045

  painter = new BrushPainter(model.mesh)
  painter.color.set(state.color)
  painter.radius = state.brushRadius
  painter.strength = state.strength
  painter.frontFacingOnly = state.frontFacingOnly

  region = new RegionTool(model.mesh)
  region.selectMode = state.regionMode
  region.angleThreshold = state.regionAngle
  region.wholeShell = state.wholeShell
  // Build adjacency + default segmentation off the render so the first region
  // hover/click is instant. (~400ms CPU; deferred so it doesn't block.)
  setTimeout(() => region!.warm(), 60)

  history = new ColorHistory(
    model.geometry.getAttribute('color') as THREE.BufferAttribute,
  )
  highlighter = new Highlighter(model.geometry)

  gui = buildUI({
    state,
    painter,
    region,
    geometry: model.geometry,
    maxBrush: modelRadius * 0.5,
    onModeChange: applyMode,
    onUndo: () => history?.undo(),
    onRedo: () => history?.redo(),
  })

  applyMode(state.mode)
  modelInfo =
    `${label} · ${model.triangleCount.toLocaleString()} triangles · ` +
    `${model.vertexCount.toLocaleString()} verts`
  updateHud()
  overlay.classList.add('hidden')
}

loadModel(MODEL_URL)
  .then((model) => installModel(model, 'Orc model'))
  .catch((err: unknown) =>
  {
    const message = err instanceof Error ? err.message : String(err)
    overlay.textContent = `Failed to load model: ${message}`
    console.error(err)
  })

// --- drag & drop import: .stl (fresh) or .ply (recovers painted colors) ------
const dropHint = document.getElementById('drophint') as HTMLDivElement
let dragDepth = 0

function importFile(file: File): void
{
  const name = file.name
  const lower = name.toLowerCase()
  if (!lower.endsWith('.stl') && !lower.endsWith('.ply'))
  {
    overlay.textContent = `Unsupported file: ${name} — drop a .stl or .ply`
    overlay.classList.remove('hidden')
    setTimeout(() => overlay.classList.add('hidden'), 2200)
    return
  }
  overlay.textContent = `Loading ${name}…`
  overlay.classList.remove('hidden')
  file
    .arrayBuffer()
    .then((data) =>
    {
      const model = lower.endsWith('.ply') ? buildFromPLY(data) : buildFromSTL(data)
      installModel(model, name)
    })
    .catch((err: unknown) =>
    {
      const message = err instanceof Error ? err.message : String(err)
      overlay.textContent = `Failed to load ${name}: ${message}`
      console.error(err)
    })
}

window.addEventListener('dragenter', (e) =>
{
  e.preventDefault()
  dragDepth++
  dropHint.classList.add('show')
})
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('dragleave', (e) =>
{
  e.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropHint.classList.remove('show')
})
window.addEventListener('drop', (e) =>
{
  e.preventDefault()
  dragDepth = 0
  dropHint.classList.remove('show')
  const file = e.dataTransfer?.files?.[0]
  if (file) importFile(file)
})

// Update the region hover preview at most once per frame (only when moved).
function updateHover(): void
{
  if (!hoverDirty) return
  hoverDirty = false
  if (state.mode !== 'region' || painting || regionPainting) return
  if (!region || !highlighter) return
  if (!region.isReady) { hoverDirty = true; return } // segmentation still warming

  const face = region.pickFace(hoverNdc, ctx.camera)
  const faces = face == null ? null : region.select(face)
  if (faces === lastHoverFaces) return // same segment under cursor — nothing to do
  lastHoverFaces = faces

  if (faces == null) highlighter.clear()
  else highlighter.set(faces)
}

function animate(): void
{
  requestAnimationFrame(animate)
  updateHover()
  ctx.controls.update()
  ctx.renderer.render(ctx.scene, ctx.camera)
}
animate()
