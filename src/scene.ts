import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  grid: THREE.GridHelper
}

const BACKGROUND = 0x1a1d21

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

  const grid = new THREE.GridHelper(1000, 50, 0x3a4047, 0x262b30)
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
