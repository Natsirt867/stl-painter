import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface LoadedModel {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  /** Triangle count of the model. */
  triangleCount: number
  /** Vertex count after welding coincident positions. */
  vertexCount: number
}

// Neutral base "primer" a fresh (uncolored) model starts painted with.
const BASE_COLOR = new THREE.Color(0xb9bdc4)

/** Fetch + parse the bundled STL. */
export async function loadModel(url: string): Promise<LoadedModel>
{
  const data = await (await fetch(url)).arrayBuffer()
  return buildFromSTL(data)
}

/** Parse an STL (binary/ASCII) into a fresh, gray-primed paintable model. */
export function buildFromSTL(data: ArrayBuffer): LoadedModel
{
  const raw = new STLLoader().parse(data)
  const triangleCount = raw.attributes.position.count / 3

  // STL is an unindexed triangle soup. Weld by position into an indexed mesh so
  // vertex colors blend continuously and face adjacency can be built.
  raw.deleteAttribute('normal')
  raw.deleteAttribute('uv')
  const geometry = mergeVertices(raw)

  return finalize(geometry, triangleCount, null)
}

/**
 * Parse a PLY back into a paintable model, restoring its per-vertex colors.
 * (PLYLoader returns linear-space colors, matching how we store paint, so the
 * exported→imported round-trip is exact.) This is how a previously exported,
 * painted model is recovered.
 */
export function buildFromPLY(data: ArrayBuffer): LoadedModel
{
  let geometry = new PLYLoader().parse(data)
  if (!geometry.index) geometry = mergeVertices(geometry)

  const triangleCount = geometry.index!.count / 3
  const imported = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const importedColors = imported ? (imported.array as Float32Array) : null

  return finalize(geometry, triangleCount, importedColors)
}

/**
 * Shared finishing pipeline: ensure indexed, recompute normals, center on the
 * grid, install the paint-color + highlight attributes, and build the patched
 * material. `importedColors` (linear RGB, length vertexCount*3) is used as-is
 * when present; otherwise the model is primed with the base color.
 */
function finalize(
  geometry: THREE.BufferGeometry,
  triangleCount: number,
  importedColors: Float32Array | null,
): LoadedModel
{
  if (!geometry.index) geometry = mergeVertices(geometry)
  geometry.deleteAttribute('normal')
  geometry.computeVertexNormals()

  // Center on X/Z and sit the base on the grid plane (y = 0).
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  const cx = (bb.min.x + bb.max.x) / 2
  const cz = (bb.min.z + bb.max.z) / 2
  geometry.translate(-cx, -bb.min.y, -cz)
  geometry.computeBoundingBox()

  const vertexCount = geometry.attributes.position.count

  const colors = new Float32Array(vertexCount * 3)
  if (importedColors && importedColors.length === vertexCount * 3)
  {
    colors.set(importedColors)
  }
  else
  {
    for (let i = 0; i < vertexCount; i++)
    {
      colors[i * 3] = BASE_COLOR.r
      colors[i * 3 + 1] = BASE_COLOR.g
      colors[i * 3 + 2] = BASE_COLOR.b
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // Per-vertex highlight flag (0/1) for the region hover preview.
  const highlight = new THREE.BufferAttribute(new Float32Array(vertexCount), 1)
  highlight.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('highlight', highlight)

  const mesh = new THREE.Mesh(geometry, makeMaterial())
  mesh.name = 'paintTarget'

  return { mesh, geometry, triangleCount, vertexCount }
}

/** MeshStandardMaterial with a highlight tint driven by the `highlight` attribute. */
function makeMaterial(): THREE.MeshStandardMaterial
{
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.0,
  })

  material.onBeforeCompile = (shader) =>
  {
    shader.uniforms.uHighlightColor = { value: new THREE.Color('#36c5ff') }
    shader.vertexShader =
      'attribute float highlight;\nvarying float vHighlight;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vHighlight = highlight;',
      )
    shader.fragmentShader =
      'uniform vec3 uHighlightColor;\nvarying float vHighlight;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor, vHighlight * 0.5);',
      )
  }
  material.customProgramCacheKey = () => 'painter-highlight-v1'
  return material
}
