/**
 * Continuously orients this SceneObject so its local +Y axis points at the camera.
 * Attach to any SceneObject (UI card, world label, etc.). Drop in the camera
 * reference and you're done.
 *
 * `yawOnly` is on by default: the object only rotates around world up so it stays
 * upright (the standard "UI card always faces me" behavior). Disable it for a full
 * free billboard that also tilts up/down.
 */

const LOG_TAG = "[FaceCameraOnY]"

@component
export class FaceCameraOnY extends BaseScriptComponent {
  @input
  @hint("Camera SceneObject to face. The local +Y axis of this object will rotate to point toward this camera each frame.")
  cameraObject: SceneObject

  @input
  @hint("Yaw only: rotate only around world Y so the object stays upright (typical UI card billboard, prevents the card lying flat when the camera is above the object). Disable for a full free billboard that also tilts.")
  yawOnly: boolean = true

  @input
  @hint("Smoothing speed (higher = snappier catch-up). Set to 0 for an instant snap each frame.")
  smoothingSpeed: number = 0

  private tr: Transform
  private camTr: Transform

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
      // Project the camera onto the object's horizontal plane so the object only
      // yaws around world up. Keeps the card upright and avoids the degenerate
      // lookAt when the camera is directly above/below the object.
      targetPos = new vec3(targetPos.x, objPos.y, targetPos.z)
    }

    if (objPos.distance(targetPos) < 0.01) return

    const toCamera = targetPos.sub(objPos).normalize()

    // quat.lookAt(forward, up) aligns local +Z with `forward` and local +Y with `up`
    // (orthogonalized to forward). To make local +Y face the camera, we pass the
    // toCamera direction as `up`, and world DOWN as `forward` so the local +Z axis
    // points toward the floor. That puts the local -Z axis up toward the sky, which
    // matches the common UI prefab convention where the content's "top" sits on the
    // -Z side of the card, so the content reads upright when viewed from +Y.
    const worldDown = new vec3(0, -1, 0)
    const dotDown = Math.abs(toCamera.dot(worldDown))
    // If toCamera is nearly parallel to world down (free-billboard mode with the
    // camera directly above/below), world down cannot serve as the +Z reference.
    // Fall back to world right so the basis stays well-defined.
    const forward = dotDown > 0.99 ? new vec3(1, 0, 0) : worldDown

    const desired = quat.lookAt(forward, toCamera)

    if (this.smoothingSpeed > 0) {
      const t = Math.min(getDeltaTime() * this.smoothingSpeed, 1)
      this.tr.setWorldRotation(quat.slerp(this.tr.getWorldRotation(), desired, t))
    } else {
      this.tr.setWorldRotation(desired)
    }
  }
}
