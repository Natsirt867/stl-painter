import * as THREE from 'three'

/**
 * Drives the region hover preview by toggling a per-vertex `highlight`
 * attribute (0/1) that the patched material tints. Tracks the previously
 * highlighted faces so each update only touches the changed vertices.
 */
export class Highlighter
{
  private readonly attr: THREE.BufferAttribute
  private readonly index: THREE.BufferAttribute
  private lastFaces: number[] = []

  constructor(geometry: THREE.BufferGeometry)
  {
    this.attr = geometry.getAttribute('highlight') as THREE.BufferAttribute
    this.index = geometry.index as THREE.BufferAttribute
  }

  /** Highlight exactly these faces (clearing the previous set). */
  set(faces: number[]): void
  {
    if (faces === this.lastFaces) return
    this.write(this.lastFaces, 0)
    this.write(faces, 1)
    this.lastFaces = faces
    this.attr.needsUpdate = true
  }

  clear(): void
  {
    if (this.lastFaces.length === 0) return
    this.write(this.lastFaces, 0)
    this.lastFaces = []
    this.attr.needsUpdate = true
  }

  private write(faces: number[], value: number): void
  {
    const { attr, index } = this
    for (let i = 0; i < faces.length; i++)
    {
      const o = faces[i] * 3
      attr.setX(index.getX(o), value)
      attr.setX(index.getX(o + 1), value)
      attr.setX(index.getX(o + 2), value)
    }
  }
}
