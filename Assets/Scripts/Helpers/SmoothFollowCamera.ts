@component
export class SmoothFollowCamera extends BaseScriptComponent {
  @input
  @hint("How quickly the card catches up (higher = snappier)")
  followSpeed: number = 10

  private tr: Transform
  private camTr: Transform
  private localOffset: vec3
  private localRotOffset: quat

  onAwake() {
    this.tr = this.getTransform()
    this.localOffset = this.tr.getLocalPosition()
    this.localRotOffset = this.tr.getLocalRotation()

    const parent = this.getSceneObject().getParent()
    if (!parent) {
      print("[SmoothFollowCamera] Must be a child of the camera at start.")
      return
    }
    this.camTr = parent.getTransform()

    this.getSceneObject().setParent(null)

    const camPos = this.camTr.getWorldPosition()
    const camRot = this.camTr.getWorldRotation()
    this.tr.setWorldPosition(camPos.add(camRot.multiplyVec3(this.localOffset)))
    this.tr.setWorldRotation(camRot.multiply(this.localRotOffset))

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate() {
    const dt = getDeltaTime()
    const t = Math.min(dt * this.followSpeed, 1)

    const camPos = this.camTr.getWorldPosition()
    const camRot = this.camTr.getWorldRotation()

    const desiredPos = camPos.add(camRot.multiplyVec3(this.localOffset))
    const desiredRot = camRot.multiply(this.localRotOffset)

    this.tr.setWorldPosition(vec3.lerp(this.tr.getWorldPosition(), desiredPos, t))
    this.tr.setWorldRotation(quat.slerp(this.tr.getWorldRotation(), desiredRot, t))
  }
}
