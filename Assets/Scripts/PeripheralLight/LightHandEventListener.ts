/**
 * This script listens for events from the Light Hand Input Manager and passes them to the Light Controller
 * If the user clicks the "place" toggle button on the light's ui panel, this script will use the
 * world query to place the light in space, and add that position to the Light Hand Input Manager.
 */

import {CancelToken, clearTimeout, setTimeout} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils"
import {SurfaceDetectionMod} from "Surface Detection [Modified]/Scripts/SurfaceDetectionMod"
import {GameOnboardingManager} from "../Core/GameOnboardingManager"
import {LightController} from "./LightController"
import {LightHandInputManager} from "./LightHandInputManager"

@component
export class LightHandEventListener extends BaseScriptComponent {
  @input
  cam: Camera

  @input
  lightController: LightController

  @input
  pfbSurfaceDetection: ObjectPrefab

  @input
  lightHandInputManager: LightHandInputManager

  @input
  text: Text

  private surfaceDetectionMod: SurfaceDetectionMod
  public surfaceDetectionPosition: vec3

  private timeoutCancelToken: CancelToken

  onAwake() {
    this.surfaceDetectionPosition = undefined
    this.lightHandInputManager.addListener(this)
    this.text.text = "Place light"
  }

  init() {}

  onPinch() {
    this.text.text = "Look at light"

    // Hide the Bluetooth scan results menu so the Place Light flow has the
    // screen to itself. GameOnboardingManager owns that root; we go through
    // the singleton instead of taking another @input on this prefab.
    GameOnboardingManager.getInstance()?.onPlaceLightPressed()

    // Hide the Place Light button + label so the player isn't shown a stale
    // affordance while surface detection is running. We discover the button
    // SceneObject by walking up from the already-wired `text` field -- the
    // text Text component lives on a child of the button (the "Pinch Button
    // - Manual Placement" SceneObject in pfbLight), so its parent is the
    // button root that owns both the PinchButton ScriptComponent and the
    // text label child. No extra Inspector wiring needed.
    this.hidePlaceLightUi()

    this.timeoutCancelToken = setTimeout(() => {
      clearTimeout(this.timeoutCancelToken)
      this.text.text = "Place light"
    }, 4)
    const surfaceDetectionSo = this.pfbSurfaceDetection.instantiate(null)
    this.surfaceDetectionMod = surfaceDetectionSo.getChild(0).getComponent("ScriptComponent") as SurfaceDetectionMod
    this.surfaceDetectionMod.init(this.cam.getSceneObject())
    this.surfaceDetectionMod.startGroundCalibration((pos, rot) => {
      this.onSurfaceDetected(pos, rot)
    })
  }

  private onSurfaceDetected(pos: vec3, rot: quat) {
    this.surfaceDetectionPosition = pos
    this.lightHandInputManager.onLightPlacedWithSurfaceDetection(pos)
  }

  resetBrightnessAndColorStates() {
    this.lightController.resetBrightnessAndColorStates()
  }

  selectColorGestureScreenSpacePos(screenSpacePos: vec2) {
    this.lightController.selectColorGestureScreenSpacePos(screenSpacePos)
  }

  togglePowerFromGesture(val: boolean) {
    this.lightController.togglePowerFromGesture(val)
  }

  private hidePlaceLightUi() {
    if (!this.text) return
    const textSo = this.text.getSceneObject()
    if (!textSo) return
    const buttonSo = textSo.getParent()
    if (buttonSo) {
      // Disabling the button root hides the PinchButton interactable, its
      // visuals, and the text label child in one operation.
      buttonSo.enabled = false
    } else {
      // Fallback: no parent (text is a root) -- just hide the text itself.
      textSo.enabled = false
    }
  }
}
