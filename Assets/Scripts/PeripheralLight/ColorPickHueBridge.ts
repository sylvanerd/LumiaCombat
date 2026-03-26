import {ColorPickController} from "./ColorPickController"
import {HueEventEmitter} from "./HueEventEmitter"

const LOG_TAG = "[ColorPickBridge]"

/**
 * Place this script on the same prefab as HueEventEmitter.
 * When the prefab is instantiated (light connects), it automatically
 * registers the HueEventEmitter with the scene's ColorPickController.
 */
@component
export class ColorPickHueBridge extends BaseScriptComponent {
  @input
  hueEventEmitter: HueEventEmitter

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    if (!this.hueEventEmitter) {
      print(`${LOG_TAG} ERROR: hueEventEmitter input not wired`)
      return
    }

    const controller = ColorPickController.getInstance()
    if (controller) {
      controller.setHueEventEmitter(this.hueEventEmitter)
      print(`${LOG_TAG} Registered HueEventEmitter with ColorPickController`)
    } else {
      print(`${LOG_TAG} WARNING: ColorPickController not found in scene, retrying...`)
      this.createEvent("UpdateEvent").bind(() => this.retryRegistration())
    }
  }

  private registered = false

  private retryRegistration() {
    if (this.registered) return
    const controller = ColorPickController.getInstance()
    if (controller) {
      controller.setHueEventEmitter(this.hueEventEmitter)
      print(`${LOG_TAG} Registered HueEventEmitter with ColorPickController (retry)`)
      this.registered = true
    }
  }
}
