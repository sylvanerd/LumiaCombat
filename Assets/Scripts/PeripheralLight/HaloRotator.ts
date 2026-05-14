const LOG_TAG = "[HaloRotator]"

const DEG_TO_RAD = Math.PI / 180

/**
 * Rotates the SceneObject this is attached to at a constant angular velocity
 * around the local Y axis. Used to spin the lamp halo VFX as a rigid ring,
 * so all particles follow circular paths without needing per-particle forces.
 *
 * Relies on the VFX graph's Update Particle being in Local Space; when the
 * parent SceneObject rotates, the local coordinate frame rotates with it
 * and every live particle rotates as one.
 *
 * The base local rotation is captured on Awake and the spin is composed on
 * top of it, so any non-identity authored rotation in the prefab is preserved.
 */
@component
export class HaloRotator extends BaseScriptComponent {
  @input
  @hint("Rotation speed in degrees per second. Positive = clockwise viewed from above (+Y looking down). Negative = counter-clockwise. Set to 0 to freeze.")
  rotationSpeed: number = 30

  @input
  @hint("If true, the script will print one debug line per second showing the current angle (useful for confirming the script is wired and running).")
  debugLog: boolean = false

  private angleRadians: number = 0
  private baseRotation: quat = quat.quatIdentity()
  private nextLogTime: number = 0

  onAwake() {
    this.baseRotation = this.sceneObject.getTransform().getLocalRotation()
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    print(`${LOG_TAG} Awake on '${this.sceneObject.name}', speed=${this.rotationSpeed} deg/s`)
  }

  private onUpdate() {
    this.angleRadians += this.rotationSpeed * DEG_TO_RAD * getDeltaTime()

    if (this.angleRadians > Math.PI * 2) this.angleRadians -= Math.PI * 2
    else if (this.angleRadians < -Math.PI * 2) this.angleRadians += Math.PI * 2

    const spin = quat.angleAxis(this.angleRadians, vec3.up())
    this.sceneObject.getTransform().setLocalRotation(this.baseRotation.multiply(spin))

    if (this.debugLog) {
      const now = getTime()
      if (now >= this.nextLogTime) {
        this.nextLogTime = now + 1
        print(`${LOG_TAG} angle=${(this.angleRadians / DEG_TO_RAD).toFixed(1)} deg`)
      }
    }
  }
}
