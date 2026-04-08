import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {ColorPickController} from "./ColorPickController"
import {ColorPickPinchDetector} from "./ColorPickPinchDetector"
import {HandLatticeVFXController} from "./HandLatticeVFXController"

const LOG_TAG = "[ColorRing]"
const SPHERE_COUNT = 6
const TWO_PI = 2 * Math.PI

@component
export class ColorHistoryRing extends BaseScriptComponent {
  @input
  @hint("Small sphere prefab (with RenderMeshVisual + material)")
  spherePrefab: ObjectPrefab

  @input
  @hint("Radius of the hexagonal ring")
  ringRadius: number = 1.5

  @input
  @hint("Uniform scale of each sphere")
  sphereScale: number = 0.5

  @input
  @hint("Sphere collider radius (only used if prefab has no collider)")
  sphereColliderRadius: number = 0.4

  @input
  @hint("Initial dimmed transparent white color")
  defaultColor: vec4 = new vec4(1, 1, 1, 0.15)

  @input
  @hint("HandLatticeVFXController for applying sphere color to hand mesh")
  latticeVFX: HandLatticeVFXController

  @input
  @hint("ColorPickPinchDetector to suppress during sphere touch")
  pinchDetector: ColorPickPinchDetector

  @input
  @hint("Left index finger probe (SceneObject with intangible ColliderComponent, attached to hand tracking index-3)")
  @allowUndefined
  leftIndexProbe: SceneObject

  @input
  @hint("Right index finger probe (SceneObject with intangible ColliderComponent, attached to hand tracking index-3)")
  @allowUndefined
  rightIndexProbe: SceneObject

  @input
  @hint("Distance threshold for suppression release safety check")
  releaseDistance: number = 1.5

  private sphereObjects: SceneObject[] = []
  private sphereMaterials: Material[] = []
  private colorSlots: (vec4 | null)[] = []
  private writeIndex: number = 0

  private leftHand: TrackedHand | null = null
  private rightHand: TrackedHand | null = null

  private isSuppressing: boolean = false
  private lastTouchedSphereIndex: number = -1
  private touchingProbes: Set<string> = new Set()

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart() {
    this.resolveHands()
    this.createSpheres()
    this.wireProbeOverlapEvents()
    this.subscribeToColorEvents()
  }

  private resolveHands() {
    try {
      this.leftHand = SIK.HandInputData.getHand("left")
      this.rightHand = SIK.HandInputData.getHand("right")
    } catch (e) {
      print(`${LOG_TAG} WARNING: Could not access hand tracking data`)
    }
  }

  private createSpheres() {
    if (!this.spherePrefab) {
      print(`${LOG_TAG} ERROR: spherePrefab not assigned`)
      return
    }

    for (let i = 0; i < SPHERE_COUNT; i++) {
      const angle = i * (TWO_PI / SPHERE_COUNT)
      const x = this.ringRadius * Math.cos(angle)
      const z = this.ringRadius * Math.sin(angle)

      const sphere = this.spherePrefab.instantiate(this.getSceneObject())
      sphere.name = `ColorSphere_${i}`
      const tr = sphere.getTransform()
      tr.setLocalPosition(new vec3(x, 0, z))
      tr.setLocalScale(vec3.one().uniformScale(this.sphereScale))

      const rmv = sphere.getComponent("RenderMeshVisual") as RenderMeshVisual
      let mat: Material = null
      if (rmv) {
        mat = rmv.mainMaterial.clone()
        rmv.mainMaterial = mat
        mat.mainPass.baseColor = this.defaultColor
      }

      this.ensureCollider(sphere)

      this.sphereObjects.push(sphere)
      this.sphereMaterials.push(mat)
      this.colorSlots.push(null)
    }

    print(`${LOG_TAG} Created ${SPHERE_COUNT} spheres in hexagonal ring (radius=${this.ringRadius})`)
  }

  private ensureCollider(sphere: SceneObject): ColliderComponent {
    let collider = sphere.getComponent("Physics.ColliderComponent") as ColliderComponent
    if (!collider) {
      collider = sphere.createComponent("Physics.ColliderComponent") as ColliderComponent
      const shape = Shape.createSphereShape()
      shape.radius = this.sphereColliderRadius
      collider.shape = shape
    }
    collider.intangible = true
    collider.overlapFilter.includeIntangible = true
    collider.overlapFilter.includeStatic = true
    collider.overlapFilter.includeDynamic = true
    return collider
  }

  private wireProbeOverlapEvents() {
    const probes = [
      {obj: this.leftIndexProbe, name: "LI"},
      {obj: this.rightIndexProbe, name: "RI"}
    ]

    let wiredCount = 0
    for (const probe of probes) {
      if (!probe.obj) continue
      let collider = probe.obj.getComponent("Physics.BodyComponent") as ColliderComponent
      if (!collider) {
        collider = probe.obj.getComponent("Physics.ColliderComponent") as ColliderComponent
      }
      if (!collider) {
        print(`${LOG_TAG} WARNING: Probe "${probe.name}" has no ColliderComponent or BodyComponent`)
        continue
      }

      collider.intangible = true
      collider.overlapFilter.includeIntangible = true
      collider.overlapFilter.includeStatic = true
      collider.overlapFilter.includeDynamic = true

      const probeName = probe.name
      collider.onOverlapEnter.add((e: OverlapEnterEventArgs) => {
        this.onProbeOverlapEnter(probeName, e)
      })
      collider.onOverlapExit.add((e: OverlapExitEventArgs) => {
        this.onProbeOverlapExit(probeName, e)
      })
      wiredCount++
    }

    print(`${LOG_TAG} Wired overlap events on ${wiredCount} finger probes`)
  }

  private findSphereIndex(sceneObj: SceneObject): number {
    for (let i = 0; i < this.sphereObjects.length; i++) {
      if (this.sphereObjects[i] === sceneObj) return i
    }
    return -1
  }

  private onProbeOverlapEnter(probeName: string, e: OverlapEnterEventArgs) {
    const hitObj = e.overlap.collider.getSceneObject()
    const sphereIndex = this.findSphereIndex(hitObj)
    if (sphereIndex < 0) return

    const storedColor = this.colorSlots[sphereIndex]
    if (!storedColor) {
      print(`${LOG_TAG} Sphere ${sphereIndex} touched but has no stored color`)
      return
    }

    const nearestIndex = this.findNearestSphereToProbe(probeName)
    if (nearestIndex >= 0 && nearestIndex !== sphereIndex) return

    const key = `${probeName}_${sphereIndex}`
    this.touchingProbes.add(key)
    this.lastTouchedSphereIndex = sphereIndex
    this.setSuppressed(true)

    if (this.latticeVFX) {
      this.latticeVFX.applyColor(storedColor)
      print(`${LOG_TAG} Sphere ${sphereIndex} touched by ${probeName} — applied color to hand mesh`)
    }
  }

  private onProbeOverlapExit(probeName: string, e: OverlapExitEventArgs) {
    const hitObj = e.overlap.collider.getSceneObject()
    const sphereIndex = this.findSphereIndex(hitObj)
    if (sphereIndex < 0) return

    const key = `${probeName}_${sphereIndex}`
    this.touchingProbes.delete(key)
  }

  private findNearestSphereToProbe(probeName: string): number {
    let probeObj: SceneObject = null
    if (probeName === "LI") probeObj = this.leftIndexProbe
    else if (probeName === "RI") probeObj = this.rightIndexProbe

    if (!probeObj) return -1

    const probePos = probeObj.getTransform().getWorldPosition()
    let bestIndex = -1
    let bestDist = Infinity

    for (let i = 0; i < this.sphereObjects.length; i++) {
      if (!this.sphereObjects[i] || !this.sphereObjects[i].enabled) continue
      if (!this.colorSlots[i]) continue
      const dist = probePos.sub(this.sphereObjects[i].getTransform().getWorldPosition()).length
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = i
      }
    }

    return bestIndex
  }

  private setSuppressed(value: boolean) {
    if (this.isSuppressing === value) return
    this.isSuppressing = value
    if (this.pinchDetector) {
      this.pinchDetector.suppressed = value
    }
    if (!value) {
      this.touchingProbes.clear()
      this.lastTouchedSphereIndex = -1
      print(`${LOG_TAG} Suppression cleared — extraction re-enabled`)
    }
  }

  private subscribeToColorEvents() {
    const delayedEvent = this.createEvent("DelayedCallbackEvent")
    delayedEvent.bind(() => {
      const controller = ColorPickController.getInstance()
      if (controller) {
        controller.onColorDetected.add((color: vec4) => {
          this.onColorExtracted(color)
        })
        print(`${LOG_TAG} Subscribed to ColorPickController.onColorDetected`)
      } else {
        print(`${LOG_TAG} WARNING: ColorPickController instance not found`)
      }
    })
    delayedEvent.reset(1.0)
  }

  private onColorExtracted(color: vec4) {
    if (!this.sphereMaterials[this.writeIndex]) return

    this.colorSlots[this.writeIndex] = new vec4(color.r, color.g, color.b, color.a)
    this.sphereMaterials[this.writeIndex].mainPass.baseColor = new vec4(color.r, color.g, color.b, 1.0)

    print(`${LOG_TAG} Slot ${this.writeIndex} updated: (${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)})`)
    this.writeIndex = (this.writeIndex + 1) % SPHERE_COUNT
  }

  private onUpdate() {
    this.validateSuppression()
  }

  private validateSuppression() {
    if (!this.isSuppressing) return

    if (this.touchingProbes.size > 0) {
      if (this.isAnyProbeNearAnySphere()) return
    }

    this.setSuppressed(false)
  }

  private isAnyProbeNearAnySphere(): boolean {
    const fingerPositions: vec3[] = []
    if (this.leftHand && this.leftHand.isTracked()) {
      fingerPositions.push(this.leftHand.indexTip.position)
    }
    if (this.rightHand && this.rightHand.isTracked()) {
      fingerPositions.push(this.rightHand.indexTip.position)
    }

    if (fingerPositions.length === 0) return false

    for (let i = 0; i < this.sphereObjects.length; i++) {
      if (!this.sphereObjects[i] || !this.sphereObjects[i].enabled) continue
      const spherePos = this.sphereObjects[i].getTransform().getWorldPosition()
      for (let f = 0; f < fingerPositions.length; f++) {
        const dist = fingerPositions[f].sub(spherePos).length
        if (dist < this.releaseDistance) return true
      }
    }

    return false
  }
}
