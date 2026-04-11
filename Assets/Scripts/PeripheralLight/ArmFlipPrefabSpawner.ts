import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {GameLogicManager} from "Scripts/GameLogicManager"

const LOG_TAG = "[ArmFlipSpawner]"
const EPS = 0.0001

@component
export class ArmFlipPrefabSpawner extends BaseScriptComponent {
  @input
  @hint("Hand to track: left or right")
  trackedHand: string = "left"

  @input
  @hint("Prefab A: shown when palm/front side faces user")
  prefabFront: ObjectPrefab

  @input
  @hint("Prefab B: shown when back side faces user")
  prefabBack: ObjectPrefab

  @input
  @hint("Prefab A2: additional prefab shown when palm/front side faces user")
  @allowUndefined
  prefabFront2: ObjectPrefab

  @input
  @hint("Optional camera object. If empty, uses world camera from scene")
  @allowUndefined
  cameraObject: SceneObject

  @input
  @hint("Distance from wrist along the user-facing normal (always toward the camera)")
  wristOffsetDistance: number = 2.0

  @input
  @hint("Extra offset along hand forward direction (wrist-to-fingers axis)")
  wristOffsetForward: number = 0.0

  @input
  @hint("Extra offset along hand right direction (index-to-pinky axis)")
  wristOffsetRight: number = 0.0

  @input
  @hint("Anchor follow speed for wrist position")
  positionLerpSpeed: number = 16.0

  @input
  @hint("Anchor follow speed for wrist orientation")
  rotationLerpSpeed: number = 14.0

  @input
  @hint("Smoothing speed for front/back blend value")
  blendSmoothingSpeed: number = 12.0

  @input
  @hint("Enter back-facing state when score > this value")
  backEnterThreshold: number = 0.2

  @input
  @hint("Return to front-facing state when score < this value")
  frontEnterThreshold: number = -0.2

  @input
  @hint("Treat low angle as front-facing (recommended default)")
  lowAngleIsFront: boolean = true

  @input
  @hint("Only respond to forearm roll (flip), ignore arm pitch/tilt toward camera")
  lockToFlipAxis: boolean = true

  @input
  @hint("Uniform scale for the front prefab at full visibility")
  prefabFrontScale: number = 1.0

  @input
  @hint("Uniform scale for the back prefab at full visibility")
  prefabBackScale: number = 1.0

  @input
  @hint("Uniform scale for the second front prefab at full visibility")
  prefabFront2Scale: number = 1.0

  @input
  @hint("Auto-hide tiny scaled objects for performance")
  disableTinyObjects: boolean = true

  @input
  @hint("Disable child object when its normalized scale is below this value")
  minVisibleScale: number = 0.02

  private hand: TrackedHand | null = null
  private anchor: SceneObject | null = null
  private frontObj: SceneObject | null = null
  private frontObj2: SceneObject | null = null
  private backObj: SceneObject | null = null

  private frontBaseScale: vec3 = vec3.one()
  private backBaseScale: vec3 = vec3.one()
  private frontBaseScale2: vec3 = vec3.one()

  private smoothedScore: number = 0
  private smoothedBlend: number = 0
  private isBackState: boolean = false

  private worldCameraTransform: Transform | null = null
  private warnedMissingPrefab: boolean = false

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart() {
    this.resolveCamera()
    this.resolveHand()
    this.createAnchorAndPrefabs()
  }

  private resolveCamera() {
    if (this.cameraObject) {
      this.worldCameraTransform = this.cameraObject.getTransform()
      return
    }

    const roots = global.scene.getRootObjectsCount()
    for (let i = 0; i < roots; i++) {
      const candidate = this.findFirstCamera(global.scene.getRootObject(i))
      if (candidate) {
        this.worldCameraTransform = candidate.getTransform()
        return
      }
    }
  }

  private findFirstCamera(obj: SceneObject): SceneObject | null {
    const cam = obj.getComponent("Component.Camera")
    if (cam) {
      return obj
    }
    const children = obj.getChildrenCount()
    for (let i = 0; i < children; i++) {
      const found = this.findFirstCamera(obj.getChild(i))
      if (found) return found
    }
    return null
  }

  private resolveHand() {
    const handName = this.trackedHand.toLowerCase() === "right" ? "right" : "left"
    try {
      this.hand = SIK.HandInputData.getHand(handName)
      print(`${LOG_TAG} Tracking hand: ${handName}`)
    } catch (e) {
      this.hand = null
      print(`${LOG_TAG} ERROR: Could not access hand "${handName}". Check hand tracking setup.`)
    }
  }

  private createAnchorAndPrefabs() {
    this.anchor = global.scene.createSceneObject("ArmFlipPrefabAnchor")
    this.anchor.enabled = false

    if (!this.prefabFront && !this.prefabBack) {
      this.warnMissingPrefabs("Both prefabs are missing")
      return
    }

    if (this.prefabFront) {
      this.frontObj = this.prefabFront.instantiate(this.anchor)
      this.frontBaseScale = vec3.one().uniformScale(this.prefabFrontScale)
      this.frontObj.getTransform().setLocalScale(this.frontBaseScale)
      this.registerWithGameLogicManager(this.frontObj)
    }

    if (this.prefabBack) {
      this.backObj = this.prefabBack.instantiate(this.anchor)
      this.backBaseScale = vec3.one().uniformScale(this.prefabBackScale)
      this.backObj.getTransform().setLocalScale(this.backBaseScale)
    }

    if (this.prefabFront2) {
      this.frontObj2 = this.prefabFront2.instantiate(this.anchor)
      this.frontBaseScale2 = vec3.one().uniformScale(this.prefabFront2Scale)
      this.frontObj2.getTransform().setLocalScale(this.frontBaseScale2)
    }

    if (!this.prefabFront || !this.prefabBack) {
      const missing = !this.prefabFront ? "prefabFront" : "prefabBack"
      this.warnMissingPrefabs(`${missing} not assigned; running with single prefab`)
    }

    this.applyBlendScale(0)
  }

  private registerWithGameLogicManager(obj: SceneObject) {
    const mgr = GameLogicManager.getInstance()
    if (mgr) {
      mgr.registerDebugObject(obj)
    } else {
      const delayed = this.createEvent("DelayedCallbackEvent")
      delayed.bind(() => {
        const mgrRetry = GameLogicManager.getInstance()
        if (mgrRetry) {
          mgrRetry.registerDebugObject(obj)
        } else {
          print(`${LOG_TAG} WARNING: GameLogicManager not found, color updates won't reach front prefab`)
        }
      })
      delayed.reset(1.0)
    }
  }

  private warnMissingPrefabs(msg: string) {
    if (this.warnedMissingPrefab) return
    this.warnedMissingPrefab = true
    print(`${LOG_TAG} WARNING: ${msg}`)
  }

  private onUpdate() {
    if (!this.anchor || !this.hand || !this.hand.isTracked()) {
      this.setAnchorActive(false)
      return
    }

    this.setAnchorActive(true)
    this.updateAnchorPose()
    this.updateFrontBackBlend()
  }

  private setAnchorActive(active: boolean) {
    if (this.anchor && this.anchor.enabled !== active) {
      this.anchor.enabled = active
    }
  }

  private updateAnchorPose() {
    if (!this.anchor || !this.hand) return

    const wristPos = this.hand.wrist.position
    const forward = this.hand.middleMidJoint.position.sub(this.hand.wrist.position).normalize()
    let right = this.hand.indexMidJoint.position.sub(this.hand.middleMidJoint.position).normalize()
    if (right.length < EPS) {
      right = new vec3(1, 0, 0)
    }
    let up = right.cross(forward).normalize()
    if (up.length < EPS) {
      up = vec3.up()
    }

    // Flip the normal so it always points toward the camera/user.
    const camPos = this.worldCameraTransform
      ? this.worldCameraTransform.getWorldPosition()
      : wristPos.add(vec3.forward())
    const wristToCamera = camPos.sub(wristPos).normalize()
    const facingDot = up.dot(wristToCamera)
    const userFacingNormal = facingDot >= 0 ? up : up.uniformScale(-1)

    const targetPos = wristPos
      .add(userFacingNormal.uniformScale(this.wristOffsetDistance))
      .add(forward.uniformScale(this.wristOffsetForward))
      .add(right.uniformScale(this.wristOffsetRight))

    const targetRot = quat.lookAt(forward, userFacingNormal)

    const tr = this.anchor.getTransform()
    const posLerpT = Math.min(1, getDeltaTime() * Math.max(0, this.positionLerpSpeed))
    const rotLerpT = Math.min(1, getDeltaTime() * Math.max(0, this.rotationLerpSpeed))
    tr.setWorldPosition(vec3.lerp(tr.getWorldPosition(), targetPos, posLerpT))
    tr.setWorldRotation(quat.slerp(tr.getWorldRotation(), targetRot, rotLerpT))
  }

  private updateFrontBackBlend() {
    const rawScore = this.computeFacingScore()
    const smoothT = Math.min(1, getDeltaTime() * Math.max(0, this.blendSmoothingSpeed))
    this.smoothedScore = this.lerpNumber(this.smoothedScore, rawScore, smoothT)

    // Hysteresis band avoids rapid toggling near neutral orientation.
    if (!this.isBackState && this.smoothedScore > this.backEnterThreshold) {
      this.isBackState = true
    } else if (this.isBackState && this.smoothedScore < this.frontEnterThreshold) {
      this.isBackState = false
    }

    // Drive blend from the binary hysteresis state for pitch-invariant visuals.
    // The lerp provides a smooth scale transition during actual flips.
    const targetBlend = this.isBackState ? 1.0 : 0.0
    this.smoothedBlend = this.lerpNumber(this.smoothedBlend, targetBlend, smoothT)
    this.applyBlendScale(this.smoothedBlend)
  }

  private computeFacingScore(): number {
    if (!this.hand) return -1

    if (!this.lockToFlipAxis) {
      const angle = this.hand.getFacingCameraAngle()
      if (angle !== null) {
        const front = this.lowAngleIsFront
          ? this.clamp01((90 - angle) / 90)
          : this.clamp01((angle - 90) / 90)
        return this.clamp(front * 2 - 1, -1, 1)
      }
    }

    if (!this.worldCameraTransform) {
      return -1
    }

    const wristPos = this.hand.wrist.position
    const armAxis = this.hand.middleMidJoint.position.sub(wristPos).normalize()
    const handRight = this.hand.indexMidJoint.position.sub(this.hand.middleMidJoint.position).normalize()
    const handUp = handRight.cross(armAxis).normalize()
    const handToCamera = this.worldCameraTransform.getWorldPosition().sub(wristPos).normalize()

    let dot: number
    if (this.lockToFlipAxis) {
      // Project both handUp and handToCamera onto the plane perpendicular
      // to the arm axis. This isolates forearm roll (pronation/supination)
      // and ensures the dot product can reach the full ±1 range.
      const camAlongArm = armAxis.uniformScale(handToCamera.dot(armAxis))
      const camProj = handToCamera.sub(camAlongArm)
      const camProjLen = camProj.length
      if (camProjLen < EPS) {
        return this.smoothedScore
      }

      const upAlongArm = armAxis.uniformScale(handUp.dot(armAxis))
      const upProj = handUp.sub(upAlongArm)
      const upProjLen = upProj.length
      if (upProjLen < EPS) {
        return this.smoothedScore
      }

      dot = upProj.normalize().dot(camProj.normalize())
    } else {
      dot = handUp.dot(handToCamera)
    }

    if (!this.lowAngleIsFront) {
      dot *= -1
    }
    return this.clamp(dot, -1, 1)
  }

  private applyBlendScale(backBlend: number) {
    const frontBlend = 1 - backBlend

    if (this.frontObj) {
      const frontScale = this.frontBaseScale.uniformScale(frontBlend)
      this.frontObj.getTransform().setLocalScale(frontScale)
      if (this.disableTinyObjects) {
        this.frontObj.enabled = frontBlend > this.minVisibleScale
      }
    }

    if (this.backObj) {
      const backScale = this.backBaseScale.uniformScale(backBlend)
      this.backObj.getTransform().setLocalScale(backScale)
      if (this.disableTinyObjects) {
        this.backObj.enabled = backBlend > this.minVisibleScale
      }
    }

    if (this.frontObj2) {
      const frontScale2 = this.frontBaseScale2.uniformScale(frontBlend)
      this.frontObj2.getTransform().setLocalScale(frontScale2)
      if (this.disableTinyObjects) {
        this.frontObj2.enabled = frontBlend > this.minVisibleScale
      }
    }
  }

  private lerpNumber(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  private clamp(v: number, minV: number, maxV: number): number {
    return Math.max(minV, Math.min(maxV, v))
  }

  private clamp01(v: number): number {
    return this.clamp(v, 0, 1)
  }
}
