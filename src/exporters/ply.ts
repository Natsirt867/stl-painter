import * as THREE from 'three'

/**
 * Convert a linear-light channel (how three stores vertex colors with
 * ColorManagement on) to an 8-bit sRGB value. Without this, painted colors
 * would export darker than what the user picked, because slicers/viewers read
 * PLY vertex colors as sRGB 0..255.
 */
function linearToSRGB8(c: number): number
{
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}

/**
 * Export an indexed, vertex-colored BufferGeometry to ASCII PLY. PLY natively
 * carries per-vertex color, so the painted result survives into slicers that
 * read vertex colors (PrusaSlicer, Bambu Studio, Cura via plugins, MeshLab...).
 */
export function exportPLY(geometry: THREE.BufferGeometry): Blob
{
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const col = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const index = geometry.index

  const vCount = pos.count
  const fCount = index ? index.count / 3 : pos.count / 3

  const parts: string[] = []
  parts.push('ply')
  parts.push('format ascii 1.0')
  parts.push('comment Created by STL Painter (demo)')
  parts.push(`element vertex ${vCount}`)
  parts.push('property float x', 'property float y', 'property float z')
  parts.push('property uchar red', 'property uchar green', 'property uchar blue')
  parts.push(`element face ${fCount}`)
  parts.push('property list uchar uint vertex_indices')
  parts.push('end_header')

  const hasColor = !!col
  for (let i = 0; i < vCount; i++)
  {
    const x = pos.getX(i).toFixed(4)
    const y = pos.getY(i).toFixed(4)
    const z = pos.getZ(i).toFixed(4)
    let r = 200, g = 200, b = 200
    if (hasColor)
    {
      r = linearToSRGB8(col!.getX(i))
      g = linearToSRGB8(col!.getY(i))
      b = linearToSRGB8(col!.getZ(i))
    }
    parts.push(`${x} ${y} ${z} ${r} ${g} ${b}`)
  }

  if (index)
  {
    for (let f = 0; f < fCount; f++)
    {
      const o = f * 3
      parts.push(`3 ${index.getX(o)} ${index.getX(o + 1)} ${index.getX(o + 2)}`)
    }
  }
  else
  {
    for (let f = 0; f < fCount; f++)
    {
      const o = f * 3
      parts.push(`3 ${o} ${o + 1} ${o + 2}`)
    }
  }

  return new Blob([parts.join('\n') + '\n'], { type: 'application/octet-stream' })
}
