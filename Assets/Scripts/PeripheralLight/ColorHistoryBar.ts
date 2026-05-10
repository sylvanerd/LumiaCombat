import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {ColorPickController} from "./ColorPickController"
import {ColorPickPinchDetector} from "./ColorPickPinchDetector"
import {HandVFXController} from "./HandVFXController"

const LOG_TAG = "[ColorBar]"
const SPHERE_COUNT = 5

@component
export class ColorHistoryBar extends BaseScriptComponent {
  @input
  @hint("Small sphere prefab (with RenderMeshVisual + material)")
  spherePrefab: ObjectPrefab

  @input
  @hint("Spacing between sphere centers along the arm (local Z)")
  gapDistance: number = 1.2

  @input
  @hint("Signed offset along local X toward the pinky side (positive = +X, negative = -X)")
  pinkyOffsetDistance: number = 2.0

  @input
  @hint("Shifts the entire bar along local Z (positive = toward fingers, negative = toward elbow)")
  wristToFingerOffset: number = 0

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
  private hasPinchSpawned: boolean = false

  onAwake() {
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

    const totalLength = (SPHERE_COUNT - 1) * this.gapDistance
    const endZ = totalLength / 2

    for (let i = 0; i < SPHERE_COUNT; i++) {
      const z = endZ - i * this.gapDistance + this.wristToFingerOffset

      const sphere = this.spherePrefab.instantiate(this.getSceneObject())
      sphere.name = `ColorBarSphere_${i}`
      const tr = sphere.getTransform()
      tr.setLocalPosition(new vec3(this.pinkyOffsetDistance, 0, z))
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

    print(`${LOG_TAG} Created ${SPHERE_COUNT} spheres in bar (gap=${this.gapDistance}, offset=${this.pinkyOffsetDistance})`)
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

    this.checkPinchSpawn()
  }

  private checkPinchSpawn() {
    const hands: TrackedHand[] = []
    if (this.leftHand && this.leftHand.isTracked() && this.leftHand.isPinching()) {
      hands.push(this.leftHand)
    }
    if (this.rightHand && this.rightHand.isTracked() && this.rightHand.isPinching()) {
      hands.push(this.rightHand)
    }

    if (hands.length === 0) {
      this.hasPinchSpawned = false
      return
    }

    if (this.hasPinchSpawned) return

    let bestSphere = -1
    let bestDist = Infinity
    let bestHand: TrackedHand = null

    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h]
      const midpoint = vec3.lerp(hand.thumbTip.position, hand.indexTip.position, 0.5)
      for (let i = 0; i < this.sphereObjects.length; i++) {
        if (!this.sphereObjects[i] || !this.sphereObjects[i].enabled) continue
        if (!this.colorSlots[i]) continue
        const dist = midpoint.sub(
          this.sphereObjects[i].getTransform().getWorldPosition()
        ).length
        if (dist < bestDist) {
          bestDist = dist
          bestSphere = i
          bestHand = hand
        }
      }
    }

    if (bestSphere < 0 || bestDist >= this.touchRadius) return

    const controller = ColorPickController.getInstance()
    if (!controller) return

    this.hasPinchSpawned = true
    controller.spawnPresetBall(bestHand, this.colorSlots[bestSphere])
    print(`${LOG_TAG} Pinch on sphere ${bestSphere} — spawned preset ball`)
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
