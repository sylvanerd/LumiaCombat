import {Colors} from "Scripts/Helpers/Colors"
import {Logger} from "../Helpers/Logger"

@component
export class LightStatusVisual extends BaseScriptComponent {
  @input
  sliderRmv: RenderMeshVisual

  @input
  sphereRmv: RenderMeshVisual

  private on: boolean
  private brightness: number
  private color: vec4

  private sliderMat: Material
  private sphereMat: Material

  onAwake() {
    this.brightness = 1
    this.color = Colors.black()
    this.ensureMaterials()
  }

  // Lazily clone+install materials. Safe to call multiple times. This must NOT throw,
  // because HueEventEmitter.init() drives setColor(...) which depends on materials being
  // present -- and if this throws, the BLE characteristics never bind and the bulb is dead.
  // This is also resilient to the parent SceneObject being disabled at construction time
  // (in which case onAwake never runs) -- the next setColor call will lazily init.
  private ensureMaterials() {
    try {
      if (!this.sphereMat && this.sphereRmv && this.sphereRmv.mainMaterial) {
        this.sphereMat = this.sphereRmv.mainMaterial.clone()
        this.sphereRmv.mainMaterial = this.sphereMat
      }
    } catch (e) {
      Logger.getInstance().log("[LightStatusVisual] ensureMaterials sphere failed: " + e)
    }
    try {
      if (!this.sliderMat && this.sliderRmv && this.sliderRmv.mainMaterial) {
        this.sliderMat = this.sliderRmv.mainMaterial.clone()
        this.sliderRmv.mainMaterial = this.sliderMat
      }
    } catch (e) {
      Logger.getInstance().log("[LightStatusVisual] ensureMaterials slider failed: " + e)
    }
  }

  turnOn(on: boolean) {
    this.on = on
    Logger.getInstance().log("LinkButtonColorState turnOn " + on)
    if (on) {
      this.mergeBrightnessAndColor(this.brightness, this.color)
    } else {
      this.mergeBrightnessAndColor(0, this.color)
    }
  }

  setBrightness(brightness: number) {
    // store our brightness
    this.brightness = brightness
    this.mergeBrightnessAndColor(this.brightness, this.color)
  }

  setColor(col: vec4) {
    // store our color
    this.color = col
    this.mergeBrightnessAndColor(this.brightness, this.color)
  }

  getSphereMat() {
    return this.sphereMat
  }

  private mergeBrightnessAndColor(brightness: number, color: vec4) {
    let localBrightness = brightness
    if (!this.on) {
      localBrightness = 0
    }

    const blackColor = Colors.black()

    // Mix our color and black to mimic brightness
    const mergedColor = color.uniformScale(localBrightness).add(blackColor.uniformScale(1 - localBrightness))

    // Defensive: if onAwake didn't run (e.g., the SceneObject is disabled in the prefab) we
    // would have undefined materials. Lazy-init here so a missing visual never aborts the
    // caller (HueEventEmitter.init -> setColor) and breaks the BLE chain.
    this.ensureMaterials()

    if (this.sphereMat && this.sphereMat.mainPass) {
      this.sphereMat.mainPass.customColor = mergedColor
    }

    if (this.sliderRmv && this.sliderRmv.mainMaterial && this.sliderRmv.mainMaterial.mainPass) {
      this.sliderRmv.mainMaterial.mainPass.Tweak_N3 = color
    }
  }

  getColor() {
    return this.color
  }
}
