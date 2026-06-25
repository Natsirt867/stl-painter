import * as THREE from 'three'

export type SelectMode = 'segment' | 'flood'

/**
 * Region selection for fills.
 *
 *  - 'segment' (default): the mesh is pre-partitioned into hard-surface
 *    segments at SEVERAL sharpness levels. Because a sharp edge at a loose angle
 *    is also sharp at a tighter one, the levels are strictly *nested* — coarser
 *    levels are unions of finer ones. The user scrolls to grow/shrink the
 *    selection through these levels instead of fiddling a global angle slider.
 *    Clicking fills the segment under the cursor at the current level, bounded
 *    by real creases (so a battle axe's blade and handle stay separate).
 *
 *  - 'flood': the original magic-wand flood from the seed face.
 *
 * The face under the cursor is found with the BVH raycast (pixel-exact), so the
 * segment is resolved on the CPU — no GPU read-back needed.
 */
export class RegionTool
{
  selectMode: SelectMode = 'segment'

  /** flood mode: max crease angle (degrees) the flood will cross. */
  angleThreshold = 35
  /** flood mode: ignore the angle and fill the whole connected shell. */
  wholeShell = false

  // Ascending sharp-edge angles → finer..coarser, strictly nested segmentations.
  private readonly levelAngles = [8, 12, 20, 30, 42, 55, 70]
  // Default to a fairly fine level (12°) so small parts don't overspray;
  // index 0 (8°) is available below for even finer selections.
  private level = 1
  private levels: Int32Array[] = [] // segmentOf per level

  private readonly mesh: THREE.Mesh
  private readonly geometry: THREE.BufferGeometry
  private readonly position: THREE.BufferAttribute
  private readonly colors: THREE.BufferAttribute
  private readonly index: THREE.BufferAttribute
  private readonly faceCount: number

  private readonly raycaster = new THREE.Raycaster()

  private ready = false
  private adjStart!: Int32Array
  private adjList!: Int32Array
  private faceNormals!: Float32Array
  private visited!: Uint8Array

  // Cache the last resolved segment so re-hovering the same part is free.
  private cacheKey = -1
  private cacheFaces: number[] = []

  constructor(mesh: THREE.Mesh)
  {
    this.mesh = mesh
    this.geometry = mesh.geometry
    this.position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    this.colors = this.geometry.getAttribute('color') as THREE.BufferAttribute
    this.index = this.geometry.index as THREE.BufferAttribute
    this.faceCount = this.index.count / 3
    ;(this.raycaster as any).firstHitOnly = true
  }

  get isReady(): boolean { return this.ready }
  get levelIndex(): number { return this.level }
  get levelCount(): number { return this.levelAngles.length }
  get levelAngle(): number { return this.levelAngles[this.level] }

  /** Build adjacency + face normals. ~360ms for 300k faces. */
  build(): void
  {
    if (this.ready) return
    this.buildFaceNormals()
    this.buildAdjacency()
    this.visited = new Uint8Array(this.faceCount)
    this.ready = true
  }

  /** Warm adjacency + all segmentation levels (so the first hover is instant). */
  warm(): void
  {
    this.build()
    this.ensureLevels()
  }

  /** Grow the selection to the next coarser level. */
  growSelection(): void
  {
    if (this.level < this.levelAngles.length - 1) { this.level++; this.cacheKey = -1 }
  }

  /** Shrink the selection to the next finer level. */
  shrinkSelection(): void
  {
    if (this.level > 0) { this.level--; this.cacheKey = -1 }
  }

  /** Raycast the cursor → face index, or null on a miss. */
  pickFace(ndc: THREE.Vector2, camera: THREE.Camera): number | null
  {
    this.raycaster.setFromCamera(ndc, camera)
    const hits = this.raycaster.intersectObject(this.mesh, false)
    if (hits.length === 0 || hits[0].faceIndex == null) return null
    return hits[0].faceIndex
  }

  /** The faces the active mode would select for a given seed face. */
  select(faceIndex: number): number[]
  {
    if (!this.ready) this.build()
    if (this.selectMode === 'segment') return this.levelSelect(faceIndex)
    return this.floodRegion(faceIndex)
  }

  applyColor(faces: number[], color: THREE.Color): void
  {
    const { index, colors } = this
    const r = color.r
    const g = color.g
    const b = color.b
    for (let i = 0; i < faces.length; i++)
    {
      const o = faces[i] * 3
      colors.setXYZ(index.getX(o), r, g, b)
      colors.setXYZ(index.getX(o + 1), r, g, b)
      colors.setXYZ(index.getX(o + 2), r, g, b)
    }
    colors.needsUpdate = true
  }

  // --- segmentation levels -------------------------------------------------

  private ensureLevels(): void
  {
    if (this.levels.length > 0) return
    if (!this.ready) this.build()
    for (const angle of this.levelAngles) this.levels.push(this.partition(angle))
  }

  private levelSelect(faceIndex: number): number[]
  {
    this.ensureLevels()
    const seg = this.levels[this.level]
    const id = seg[faceIndex]
    if (id < 0) return []

    const key = this.level * this.faceCount + id
    if (key === this.cacheKey) return this.cacheFaces

    const faces: number[] = []
    for (let f = 0; f < this.faceCount; f++) if (seg[f] === id) faces.push(f)
    this.cacheKey = key
    this.cacheFaces = faces
    return faces
  }

  /** Partition the whole mesh into segments, splitting at edges sharper than `angleDeg`. */
  private partition(angleDeg: number): Int32Array
  {
    const { adjStart, adjList, faceNormals, faceCount } = this
    const cos = Math.cos((angleDeg * Math.PI) / 180)
    const seg = new Int32Array(faceCount).fill(-1)
    const stack: number[] = []
    let id = 0

    for (let s = 0; s < faceCount; s++)
    {
      if (seg[s] !== -1) continue
      stack.length = 0
      stack.push(s)
      seg[s] = id

      while (stack.length > 0)
      {
        const f = stack.pop()!
        const fx = faceNormals[f * 3]
        const fy = faceNormals[f * 3 + 1]
        const fz = faceNormals[f * 3 + 2]

        for (let k = adjStart[f]; k < adjStart[f + 1]; k++)
        {
          const n = adjList[k]
          if (seg[n] !== -1) continue
          const dot =
            fx * faceNormals[n * 3] +
            fy * faceNormals[n * 3 + 1] +
            fz * faceNormals[n * 3 + 2]
          if (dot < cos) continue // sharp edge → segment boundary
          seg[n] = id
          stack.push(n)
        }
      }
      id++
    }
    return seg
  }

  // --- flood (magic wand) --------------------------------------------------

  private floodRegion(seed: number): number[]
  {
    const { adjStart, adjList, faceNormals, visited } = this
    visited.fill(0)

    const cosThreshold = Math.cos((this.angleThreshold * Math.PI) / 180)
    const wholeShell = this.wholeShell

    const region: number[] = []
    const stack: number[] = [seed]
    visited[seed] = 1

    while (stack.length > 0)
    {
      const f = stack.pop()!
      region.push(f)

      const fx = faceNormals[f * 3]
      const fy = faceNormals[f * 3 + 1]
      const fz = faceNormals[f * 3 + 2]

      for (let k = adjStart[f]; k < adjStart[f + 1]; k++)
      {
        const n = adjList[k]
        if (visited[n]) continue
        if (!wholeShell)
        {
          const dot =
            fx * faceNormals[n * 3] +
            fy * faceNormals[n * 3 + 1] +
            fz * faceNormals[n * 3 + 2]
          if (dot < cosThreshold) continue
        }
        visited[n] = 1
        stack.push(n)
      }
    }

    return region
  }

  // --- preprocessing -------------------------------------------------------

  private buildFaceNormals(): void
  {
    const { position, index, faceCount } = this
    const normals = new Float32Array(faceCount * 3)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()

    for (let f = 0; f < faceCount; f++)
    {
      const o = f * 3
      a.fromBufferAttribute(position, index.getX(o))
      b.fromBufferAttribute(position, index.getX(o + 1))
      c.fromBufferAttribute(position, index.getX(o + 2))
      ab.subVectors(b, a)
      ac.subVectors(c, a)
      ab.cross(ac).normalize()
      normals[o] = ab.x
      normals[o + 1] = ab.y
      normals[o + 2] = ab.z
    }
    this.faceNormals = normals
  }

  private buildAdjacency(): void
  {
    const { index, faceCount, position } = this
    const vertexCount = position.count

    const edgeToFace = new Map<number, number>()
    const neighbors: number[][] = new Array(faceCount)
    for (let f = 0; f < faceCount; f++) neighbors[f] = []

    const addEdge = (f: number, v0: number, v1: number): void =>
    {
      const lo = v0 < v1 ? v0 : v1
      const hi = v0 < v1 ? v1 : v0
      const key = lo * vertexCount + hi
      const other = edgeToFace.get(key)
      if (other === undefined) edgeToFace.set(key, f)
      else
      {
        neighbors[f].push(other)
        neighbors[other].push(f)
      }
    }

    for (let f = 0; f < faceCount; f++)
    {
      const o = f * 3
      addEdge(f, index.getX(o), index.getX(o + 1))
      addEdge(f, index.getX(o + 1), index.getX(o + 2))
      addEdge(f, index.getX(o + 2), index.getX(o))
    }

    const adjStart = new Int32Array(faceCount + 1)
    let total = 0
    for (let f = 0; f < faceCount; f++)
    {
      adjStart[f] = total
      total += neighbors[f].length
    }
    adjStart[faceCount] = total

    const adjList = new Int32Array(total)
    for (let f = 0; f < faceCount; f++)
    {
      let k = adjStart[f]
      const list = neighbors[f]
      for (let i = 0; i < list.length; i++) adjList[k++] = list[i]
    }

    this.adjStart = adjStart
    this.adjList = adjList
  }
}
