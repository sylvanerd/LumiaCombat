import {ColorPickController} from "./ColorPickController"
import {HueEventEmitter} from "./HueEventEmitter"
import {LampColliderSpawner} from "./LampColliderSpawner"
import {LightStatusVisual} from "./LightStatusVisual"

const LOG_TAG = "[CollisionGate]"

/**
 * Intercepts color-pick setColorUI calls and buffers them until the thrown ball
 * physically collides with the lamp's trigger volume. Handles both orderings:
 * color arriving before collision, and collision arriving before color.
 *
 * Toggle off by disabling this ScriptComponent in the Inspector;
 * ColorPickController will then fall back to the real HueEventEmitter.
 */
@component
export class ColorBallCollisionGate extends BaseScriptComponent {
  @input
  hueEventEmitter: HueEventEmitter

  @input
  lampColliderSpawner: LampColliderSpawner

  @input
  lightStatusVisual: LightStatusVisual

  @input
  @hint("Hide the ball on collision with the lamp")
  hideBallOnHit: boolean = true

  private pendingColor: vec4 = null
  private collisionReceived: boolean = false
  private lastBallCollider: ColliderComponent = null

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    const controller = ColorPickController.getInstance()
    if (controller) {
      controller.setHueEventEmitter(this as any)
      print(`${LOG_TAG} Registered as HueEventEmitter proxy on ColorPickController`)
    } else {
      print(`${LOG_TAG} WARNING: ColorPickController instance not found yet, will be discovered via duck-typing`)
    }

    this.lampColliderSpawner.onBallCollision.add((ballCollider: ColliderComponent) => {
      this.onCollision(ballCollider)
    })
  }

  /**
   * Duck-typed to match HueEventEmitter.setColorUI so ColorPickController
   * and findHueEventEmitterInScene() treat this as a valid target.
   */
  setColorUI(color: vec4) {
    print(`${LOG_TAG} Color received: (${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)}) — buffering`)
    this.pendingColor = color

    if (this.collisionReceived) {
      print(`${LOG_TAG} Collision was already received, applying immediately`)
      this.applyPendingColor()
    }
  }

  private onCollision(ballCollider: ColliderComponent) {
    print(`${LOG_TAG} Ball collision event received`)
    this.lastBallCollider = ballCollider

    if (this.pendingColor !== null) {
      this.applyPendingColor()
    } else {
      print(`${LOG_TAG} No color buffered yet, marking collision flag`)
      this.collisionReceived = true
    }
  }

  private applyPendingColor() {
    if (!this.pendingColor) return

    const color = this.pendingColor
    print(`${LOG_TAG} Applying color to lamp: (${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)})`)

    this.hueEventEmitter.setColorUI(color)

    if (this.hideBallOnHit && this.lastBallCollider) {
      try {
        const ballObj = this.lastBallCollider.getSceneObject()
        ballObj.enabled = false
        print(`${LOG_TAG} Ball hidden on impact`)
      } catch (e) {
        print(`${LOG_TAG} Could not hide ball: ${e}`)
      }
    }

    this.pendingColor = null
    this.collisionReceived = false
    this.lastBallCollider = null
  }
}
