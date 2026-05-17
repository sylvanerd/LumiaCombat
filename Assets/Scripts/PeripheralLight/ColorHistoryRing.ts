import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {ColorPickController} from "./ColorPickController"
import {ColorPickPinchDetector} from "./ColorPickPinchDetector"
import {HandVFXController} from "./HandVFXController"

const LOG_TAG = "[ColorRing]"
const SPHERE_COUNT = 5
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
  @hint("Initial dimmed transparent white color")
  defaultColor: vec4 = new vec4(1, 1, 1, 0.15)

  @input
  @hint("HandVFXController for applying sphere color to hand mesh")
  latticeVFX: HandVFXController

  @input
  @hint("ColorPickPinchDetector to suppress during sphere touch")
  pinchDetector: ColorPickPinchDetector

  @input
  @hint("Max distance from index fingertip to sphere center to count as a touch")
  touchRadius: number = 1.0

  private sphereObjects: SceneObject[] = []
  private sphereMaterials: Material[] = []
  private colorSlots: (vec4 | null)[] = []
  private writeIndex: number = 0

  private leftHand: TrackedHand | null = null
  private rightHand: TrackedHand | null = null

  private isSuppressing: boolean = false
  private activeSphereIndex: number = -1

  // The ring is the root SceneObject of ColorHistoryBar.prefab, which is
  // instantiated dynamically by ArmFlipPrefabSpawner -- so there is no scene-
  // level reference for GameLogicManager to wire via @input. We self-register
  // as a singleton on onAwake so the end-state flow can toggle this SceneObject
  // (which also disables the ColorHistoryBar child) on lose / restart.
  private static instance: ColorHistoryRing

  static getInstance(): ColorHistoryRing | undefined {
    return ColorHistoryRing.instance
  }

  onAwake() {
    if (ColorHistoryRing.instance) {
      print(`${LOG_TAG} WARNING: Multiple instances detected`)
    }
    ColorHistoryRing.instance = this

    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart() {
    this.resolveHands()
    this.createSpheres()
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

      this.sphereObjects.push(sphere)
      this.sphereMaterials.push(mat)
      this.colorSlots.push(null)
    }

    print(`${LOG_TAG} Created ${SPHERE_COUNT} spheres in hexagonal ring (radius=${this.ringRadius})`)
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
    this.checkFingerTouch()
  }

  private checkFingerTouch() {
    const fingerPositions: vec3[] = []
    if (this.leftHand && this.leftHand.isTracked()) {
      fingerPositions.push(this.leftHand.indexTip.position)
    }
    if (this.rightHand && this.rightHand.isTracked()) {
      fingerPositions.push(this.rightHand.indexTip.position)
    }

    let nearestSphere = -1
    let nearestDist = Infinity

    for (let f = 0; f < fingerPositions.length; f++) {
      for (let i = 0; i < this.sphereObjects.length; i++) {
        if (!this.sphereObjects[i] || !this.sphereObjects[i].enabled) continue
        if (!this.colorSlots[i]) continue
        const dist = fingerPositions[f].sub(
          this.sphereObjects[i].getTransform().getWorldPosition()
        ).length
        if (dist < nearestDist) {
          nearestDist = dist
          nearestSphere = i
        }
      }
    }

    const isTouching = nearestSphere >= 0 && nearestDist < this.touchRadius

    if (isTouching) {
      if (this.activeSphereIndex !== nearestSphere) {
        this.activeSphereIndex = nearestSphere
        this.setSuppressed(true)
        if (this.latticeVFX && this.colorSlots[nearestSphere]) {
          this.latticeVFX.applyColor(this.colorSlots[nearestSphere])
          print(`${LOG_TAG} Sphere ${nearestSphere} touched — applied color to hand mesh`)
        }
      }
    } else {
      if (this.isSuppressing) {
        this.activeSphereIndex = -1
        this.setSuppressed(false)
      }
    }
  }

  private setSuppressed(value: boolean) {
    if (this.isSuppressing === value) return
    this.isSuppressing = value
    if (this.pinchDetector) {
      this.pinchDetector.suppressed = value
    }
    if (!value) {
      print(`${LOG_TAG} Suppression cleared — extraction re-enabled`)
    }
  }
}
