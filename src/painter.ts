import * as THREE from 'three'
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh'

// Install three-mesh-bvh's accelerated raycast + bounds tree on three's
// prototypes. This makes raycasting against a 300k-tri mesh and gathering
// vertices inside the brush sphere fast enough to paint at 60fps.
;(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree
;(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree
;(THREE.Mesh.prototype as any).raycast = acceleratedRaycast

/**
 * Surface brush. Raycasts the cursor onto the mesh, then writes the brush color
 * into every vertex inside a world-space sphere around the hit point, with a
 * smooth falloff toward the edge of the brush.
 */
export class BrushPainter
{
  readonly color = new THREE.Color('#e23b2e')
  radius = 6
  strength = 0.85
  /** Skip vertices facing away from the clicked surface (no paint-through). */
  frontFacingOnly = true

  private readonly mesh: THREE.Mesh
  private readonly geometry: THREE.BufferGeometry
  private readonly position: THREE.BufferAttribute
  private readonly normals: THREE.BufferAttribute
  private readonly colors: THREE.BufferAttribute
  private readonly index: THREE.BufferAttribute

  private readonly raycaster = new THREE.Raycaster()
  private readonly sphere = new THREE.Sphere()
  private readonly tmp = new THREE.Vector3()
  private readonly refNormal = new THREE.Vector3()

  // Per-stamp visited guard so vertices shared by several triangles are
  // blended exactly once per brush stamp (otherwise shared verts paint darker).
  private readonly visited: Int32Array
  private stamp = 0

  constructor(mesh: THREE.Mesh)
  {
    this.mesh = mesh
    this.geometry = mesh.geometry
    ;(this.geometry as any).computeBoundsTree()
    ;(this.raycaster as any).firstHitOnly = true

    this.position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    this.normals = this.geometry.getAttribute('normal') as THREE.BufferAttribute
    this.colors = this.geometry.getAttribute('color') as THREE.BufferAttribute
    this.index = this.geometry.index as THREE.BufferAttribute
    this.visited = new Int32Array(this.position.count)
  }

  /** Paint one stamp at a normalized-device-coordinate. Returns true if it hit. */
  strokeAt(ndc: THREE.Vector2, camera: THREE.Camera): boolean
  {
    this.raycaster.setFromCamera(ndc, camera)
    const hits = this.raycaster.intersectObject(this.mesh, false)
    if (hits.length === 0) return false

    const hit = hits[0]
    const useFacing = this.frontFacingOnly && hit.face != null
    if (useFacing) this.refNormal.copy(hit.face!.normal)
    this.paintSphere(hit.point, useFacing)
    return true
  }

  private paintSphere(center: THREE.Vector3, useFacing: boolean): void
  {
    const bvh = (this.geometry as any).boundsTree
    if (!bvh) return

    const r = this.radius
    const r2 = r * r
    this.sphere.set(center, r)

    const stamp = ++this.stamp
    const { visited, position, normals, colors, index, tmp, refNormal, color, strength } = this

    const applyVertex = (vi: number): void =>
    {
      if (visited[vi] === stamp) return
      visited[vi] = stamp

      tmp.fromBufferAttribute(position, vi)
      const d2 = tmp.distanceToSquared(center)
      if (d2 > r2) return

      // Reject vertices on surfaces facing away from where we clicked, so the
      // brush doesn't bleed through to the back of a thin wall.
      if (useFacing)
      {
        const dot =
          normals.getX(vi) * refNormal.x +
          normals.getY(vi) * refNormal.y +
          normals.getZ(vi) * refNormal.z
        if (dot <= 0) return
      }

      // Smoothstep falloff from center (1) to edge (0).
      const t = 1 - Math.sqrt(d2) / r
      const w = strength * t * t * (3 - 2 * t)

      const cr = colors.getX(vi)
      const cg = colors.getY(vi)
      const cb = colors.getZ(vi)
      colors.setXYZ(
        vi,
        cr + (color.r - cr) * w,
        cg + (color.g - cg) * w,
        cb + (color.b - cb) * w,
      )
    }

    bvh.shapecast({
      intersectsBounds: (box: THREE.Box3) => this.sphere.intersectsBox(box),
      intersectsTriangle: (_tri: unknown, triIndex: number) =>
      {
        const i = triIndex * 3
        applyVertex(index.getX(i))
        applyVertex(index.getX(i + 1))
        applyVertex(index.getX(i + 2))
        return false
      },
    })

    colors.needsUpdate = true
  }

  dispose(): void
  {
    ;(this.geometry as any).disposeBoundsTree?.()
  }
}
