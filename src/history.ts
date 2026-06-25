import type * as THREE from 'three'

/**
 * Undo/redo for the vertex-color attribute using bounded full snapshots.
 * (150k verts * 3 floats ≈ 1.8 MB per snapshot; capped to `limit` steps.)
 */
export class ColorHistory
{
  private readonly attr: THREE.BufferAttribute
  private readonly limit: number
  private undoStack: Float32Array[] = []
  private redoStack: Float32Array[] = []

  constructor(colorAttr: THREE.BufferAttribute, limit = 40)
  {
    this.attr = colorAttr
    this.limit = limit
  }

  private snapshot(): Float32Array
  {
    return (this.attr.array as Float32Array).slice()
  }

  /** Call right BEFORE a mutating operation (stroke start / region fill). */
  begin(): void
  {
    this.undoStack.push(this.snapshot())
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack.length = 0
  }

  undo(): boolean
  {
    const prev = this.undoStack.pop()
    if (!prev) return false
    this.redoStack.push(this.snapshot())
    this.restore(prev)
    return true
  }

  redo(): boolean
  {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(this.snapshot())
    this.restore(next)
    return true
  }

  private restore(arr: Float32Array): void
  {
    ;(this.attr.array as Float32Array).set(arr)
    this.attr.needsUpdate = true
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
}
