import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  grid: THREE.LineSegments
}

const BACKGROUND = 0x14161a

/**
 * A single ground grid whose two center lines are colored as the X (red) and
 * Z (blue) axes, with the rest gray — one geometry, one draw call, all coplanar.
 */
function makeGrid(
  size: number,
  divisions: number,
  gridColor: number,
  xAxisColor: number,
  zAxisColor: number,
): THREE.LineSegments
{
  const half = size / 2
  const step = size / divisions
  const grid = new THREE.Color(gridColor)
  const xAxis = new THREE.Color(xAxisColor)
  const zAxis = new THREE.Color(zAxisColor)

  const positions: number[] = []
  const colors: number[] = []
  const segment = (x1: number, z1: number, x2: number, z2: number, c: THREE.Color): void =>
  {
    positions.push(x1, 0, z1, x2, 0, z2)
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
  }

  for (let i = 0; i <= divisions; i++)
  {
    const p = -half + i * step
    const center = Math.abs(p) < step / 2
    segment(-half, p, half, p, center ? xAxis : grid) // parallel to X; z = 0 is the X axis
    segment(p, -half, p, half, center ? zAxis : grid) // parallel to Z; x = 0 is the Z axis
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }))
}

export function createScene(canvas: HTMLCanvasElement): SceneContext
{
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    10000,
  )
  camera.position.set(0, 80, 220)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 1

  // Lighting: a hemisphere fill plus a key/fill directional pair so painted
  // colors read clearly without blowing out.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x32363b, 1.1)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xffffff, 1.7)
  key.position.set(1, 2, 3)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xffffff, 0.55)
  fill.position.set(-2, -1, -1.5)
  scene.add(fill)

  // Grid with the center lines colored as the X (red) and Z (blue) axes.
  const grid = makeGrid(1000, 50, 0x262b30, 0x8a3a36, 0x36527d)
  scene.add(grid)

  window.addEventListener('resize', () =>
  {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  return { scene, camera, renderer, controls, grid }
}

/**
 * Frame the camera to fit an object, place the orbit target at its center, and
 * drop the reference grid to the base of its bounding box.
 */
export function frameObject(ctx: SceneContext, object: THREE.Object3D): void
{
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)

  const fitDist = maxDim / (2 * Math.tan((Math.PI * ctx.camera.fov) / 360))
  const dir = new THREE.Vector3(0.4, 0.25, 1).normalize()

  ctx.camera.position.copy(center).add(dir.multiplyScalar(fitDist * 1.5))
  ctx.camera.near = maxDim / 200
  ctx.camera.far = maxDim * 200
  ctx.camera.updateProjectionMatrix()

  ctx.controls.target.copy(center)
  ctx.controls.update()

  ctx.grid.position.y = box.min.y
}
