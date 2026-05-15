/**
 * Continuously orients this SceneObject so that one of its local axes points
 * at the camera. The "face" axis is selectable (+X, -X, +Y, -Y, +Z, -Z) so
 * the same script works for any prefab regardless of which local axis is
 * authored as the "front" / camera-facing side.
 *
 * `yawOnly` is on by default: the camera target is projected onto the object's
 * horizontal plane so the object only rotates around world Y. This keeps the
 * billboard upright and avoids the degenerate lookAt when the camera is
 * directly above or below the object. Disable it for a full free billboard
 * that also tilts up/down.
 */

const LOG_TAG = "[FaceCameraOnAxis]"

const VALID_AXES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]

@component
export class FaceCameraOnAxis extends BaseScriptComponent {
  @input
  @hint("Camera SceneObject to face. The chosen local axis of this object will rotate to point toward this camera each frame.")
  cameraObject: SceneObject

  @input
  @hint("Which LOCAL axis of this object should point at the camera. Valid values: +X, -X, +Y, -Y, +Z, -Z. Cycle through these while previewing to find the axis that matches your prefab's 'front' side.")
  faceAxis: string = "+Y"

  @input
  @hint("Yaw only: rotate only around world Y so the object stays upright (typical UI card billboard, prevents the card lying flat when the camera is above the object). Disable for a full free billboard that also tilts.")
  yawOnly: boolean = true

  @input
  @hint("Smoothing speed (higher = snappier catch-up). Set to 0 for an instant snap each frame.")
  smoothingSpeed: number = 0

  private tr: Transform
  private camTr: Transform
  private cachedAxis: string = ""
  private cachedRemap: quat = quat.quatIdentity()

  onAwake() {
    this.tr = this.getTransform()

    if (!this.cameraObject) {
      print(`${LOG_TAG} WARNING: cameraObject not assigned; script disabled`)
      return
    }
    this.camTr = this.cameraObject.getTransform()

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate() {
    const objPos = this.tr.getWorldPosition()
    let targetPos = this.camTr.getWorldPosition()

    if (this.yawOnly) {
      targetPos = new vec3(targetPos.x, objPos.y, targetPos.z)
    }

    if (objPos.distance(targetPos) < 0.01) return

    const toCamera = targetPos.sub(objPos).normalize()
    const desired = this.buildRotation(toCamera)

    if (this.smoothingSpeed > 0) {
      const t = Math.min(getDeltaTime() * this.smoothingSpeed, 1)
      this.tr.setWorldRotation(quat.slerp(this.tr.getWorldRotation(), desired, t))
    } else {
      this.tr.setWorldRotation(desired)
    }
  }

  private buildRotation(toCamera: vec3): quat {
    // baseRot uses the Lens Studio convention: local +Z aligns with `forward`
    // (toCamera), local +Y aligns with `up` (worldUp, orthogonalized to forward).
    // When the camera is nearly directly above or below the object, worldUp is
    // parallel to toCamera and the basis degenerates; fall back to worldRight
    // as the up reference in that case so the lookAt stays well-defined.
    const worldUp = new vec3(0, 1, 0)
    const dotUp = Math.abs(toCamera.dot(worldUp))
    const upRef = dotUp > 0.99 ? new vec3(1, 0, 0) : worldUp
    const baseRot = quat.lookAt(toCamera, upRef)

    return baseRot.multiply(this.getAxisRemap())
  }

  private getAxisRemap(): quat {
    if (this.faceAxis === this.cachedAxis) return this.cachedRemap

    this.cachedAxis = this.faceAxis
    this.cachedRemap = this.computeAxisRemap(this.faceAxis)
    return this.cachedRemap
  }

  private computeAxisRemap(axis: string): quat {
    // baseRot puts local +Z at toCamera and local +Y at worldUp. The remap Q
    // is post-multiplied (desired = baseRot * Q), so it acts in LOCAL space
    // before baseRot is applied. We pick Q so Q * chosenAxis = (0, 0, 1) = +Z,
    // i.e. the chosen local axis ends up where +Z was, which then maps to
    // toCamera through baseRot.
    const piHalf = Math.PI / 2
    switch (axis) {
      case "+Z": return quat.quatIdentity()
      case "-Z": return quat.angleAxis(Math.PI, new vec3(0, 1, 0))
      case "+Y": return quat.angleAxis(piHalf, new vec3(1, 0, 0))
      case "-Y": return quat.angleAxis(-piHalf, new vec3(1, 0, 0))
      case "+X": return quat.angleAxis(-piHalf, new vec3(0, 1, 0))
      case "-X": return quat.angleAxis(piHalf, new vec3(0, 1, 0))
      default:
        print(`${LOG_TAG} Unknown faceAxis "${axis}"; valid values are ${VALID_AXES.join(", ")}. Falling back to +Y.`)
        return quat.angleAxis(piHalf, new vec3(1, 0, 0))
    }
  }
}
