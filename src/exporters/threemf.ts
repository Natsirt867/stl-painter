import * as THREE from 'three'
import { zipSync, strToU8 } from 'fflate'

/** Linear-light channel → 8-bit sRGB (slicers read 3MF colors as sRGB). */
function linearToSRGB8(c: number): number
{
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}

function hex2(n: number): string
{
  return n.toString(16).padStart(2, '0')
}

/**
 * Export an indexed, vertex-colored geometry to 3MF using core
 * `<basematerials>` — the discrete-material representation slicers map to
 * extruders/filaments for multi-material printing (PrusaSlicer, Bambu, Cura).
 *
 * Each unique color becomes a base material; each triangle is assigned the
 * material of its dominant vertex color. (Smooth per-vertex gradients can't be
 * printed with discrete filaments anyway, so per-triangle material is the right
 * granularity for a slicer — and solid region fills map 1:1.)
 *
 * The package is an OPC ZIP of the three required parts.
 */
export function export3MF(geometry: THREE.BufferGeometry): Blob
{
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const col = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const index = geometry.index

  const vCount = pos.count
  const fCount = index ? index.count / 3 : pos.count / 3

  // Per-vertex sRGB color key (0xRRGGBB).
  const vKey = new Int32Array(vCount)
  if (col)
  {
    for (let i = 0; i < vCount; i++)
    {
      vKey[i] =
        (linearToSRGB8(col.getX(i)) << 16) |
        (linearToSRGB8(col.getY(i)) << 8) |
        linearToSRGB8(col.getZ(i))
    }
  }

  // Build the material palette from each triangle's dominant vertex color.
  const matIndexOf = new Map<number, number>()
  const matKeys: number[] = []
  const triMat = new Int32Array(fCount)
  const hasColor = !!col

  for (let f = 0; f < fCount; f++)
  {
    const o = f * 3
    const a = index ? index.getX(o) : o
    const b = index ? index.getX(o + 1) : o + 1
    const c = index ? index.getX(o + 2) : o + 2
    const ka = vKey[a]
    const kb = vKey[b]
    const kc = vKey[c]
    const chosen = kb === kc ? kb : ka // majority vote, tie → vertex a

    let mi = matIndexOf.get(chosen)
    if (mi === undefined)
    {
      mi = matKeys.length
      matIndexOf.set(chosen, mi)
      matKeys.push(chosen)
    }
    triMat[f] = mi
  }

  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    '<model unit="millimeter" xml:lang="en-US"' +
      ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
  )
  parts.push(' <resources>')
  if (hasColor)
  {
    parts.push('  <basematerials id="1">')
    for (let i = 0; i < matKeys.length; i++)
    {
      const k = matKeys[i]
      const hex = `#${hex2((k >> 16) & 255)}${hex2((k >> 8) & 255)}${hex2(k & 255)}FF`
      parts.push(`   <base name="color${i + 1}" displaycolor="${hex}"/>`)
    }
    parts.push('  </basematerials>')
  }
  parts.push(`  <object id="2" type="model"${hasColor ? ' pid="1" pindex="0"' : ''}>`)
  parts.push('   <mesh>')
  parts.push('    <vertices>')
  for (let i = 0; i < vCount; i++)
  {
    parts.push(
      `     <vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}"/>`,
    )
  }
  parts.push('    </vertices>')
  parts.push('    <triangles>')
  for (let f = 0; f < fCount; f++)
  {
    const o = f * 3
    const a = index ? index.getX(o) : o
    const b = index ? index.getX(o + 1) : o + 1
    const c = index ? index.getX(o + 2) : o + 2
    if (hasColor)
    {
      parts.push(`     <triangle v1="${a}" v2="${b}" v3="${c}" p1="${triMat[f]}"/>`)
    }
    else
    {
      parts.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`)
    }
  }
  parts.push('    </triangles>')
  parts.push('   </mesh>')
  parts.push('  </object>')
  parts.push(' </resources>')
  parts.push(' <build>')
  parts.push('  <item objectid="2"/>')
  parts.push(' </build>')
  parts.push('</model>')

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>'
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0"' +
    ' Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>'

  const zip = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(parts.join('\n')),
  })
  return new Blob([zip], { type: 'model/3mf' })
}
