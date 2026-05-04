import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {GameLogicManager} from "Scripts/GameLogicManager"
import {HueEventEmitter} from "./HueEventEmitter"

const LOG_TAG = "[AutoColorCycler]"

@component
export class AutoColorCycler extends BaseScriptComponent {
  @input
  hueEventEmitter: HueEventEmitter

  @input
  @hint("Minimum seconds between color cycles")
  intervalSecondsMin: number = 2

  @input
  @hint("Maximum seconds between color cycles")
  intervalSecondsMax: number = 5

  @input
  autoChangeEnabled: boolean = false

  private _onColorCycled: Event<vec4> = new Event<vec4>()
  get onColorCycled() { return this._onColorCycled.publicApi() }

  private lastCycleTime: number = -1
  private currentInterval: number = 0
  private initialized: boolean = false

  onAwake() {
    print(`${LOG_TAG} onAwake called`)
    print(`${LOG_TAG} hueEventEmitter wired: ${this.hueEventEmitter != null}`)
    print(`${LOG_TAG} intervalSeconds: [${this.intervalSecondsMin}-${this.intervalSecondsMax}]`)
    print(`${LOG_TAG} autoChangeEnabled: ${this.autoChangeEnabled}`)

    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart() {
    const manager = GameLogicManager.getInstance()
    if (manager) {
      manager.registerCycler(this)
      print(`${LOG_TAG} Registered with GameLogicManager`)
    } else {
      print(`${LOG_TAG} GameLogicManager not found in scene -- contrasting color will not be computed`)
    }
  }

  startCycling() {
    this.autoChangeEnabled = true
    this.initialized = false
    print(`${LOG_TAG} Color cycling started`)
  }

  stopCycling() {
    this.autoChangeEnabled = false
    this.initialized = false
    print(`${LOG_TAG} Color cycling stopped`)
  }

  private onUpdate() {
    if (!this.autoChangeEnabled) {
      return
    }

    if (!this.hueEventEmitter) {
      print(`${LOG_TAG} WARNING: hueEventEmitter is null -- not wired in Inspector?`)
      return
    }

    const now = getTime()

    if (!this.initialized) {
      this.initialized = true
      this.lastCycleTime = now
      this.currentInterval = this.randomInterval()
      print(`${LOG_TAG} Initialized at time ${now.toFixed(2)}, waiting ${this.currentInterval.toFixed(2)}s for first cycle`)
      return
    }

    const elapsed = now - this.lastCycleTime
    if (elapsed >= this.currentInterval) {
      this.lastCycleTime = now
      this.currentInterval = this.randomInterval()
      this.cycleColor()
    }
  }

  private cycleColor() {
    const hue = Math.random()
    const rgb = this.hsvToRgb(hue, 1.0, 1.0)
    const color = new vec4(rgb.r, rgb.g, rgb.b, 1.0)
    print(`${LOG_TAG} Cycling to hue=${hue.toFixed(3)} -> rgb(${rgb.r.toFixed(2)}, ${rgb.g.toFixed(2)}, ${rgb.b.toFixed(2)})`)

    try {
      this.hueEventEmitter.setColorUI(color)
      this._onColorCycled.invoke(color)
      print(`${LOG_TAG} setColorUI called successfully`)
    } catch (e) {
      print(`${LOG_TAG} ERROR calling setColorUI: ${e}`)
    }
  }

  private randomInterval(): number {
    return this.intervalSecondsMin + Math.random() * (this.intervalSecondsMax - this.intervalSecondsMin)
  }

  private hsvToRgb(h: number, s: number, v: number): {r: number; g: number; b: number} {
    const sector = Math.floor(h * 6)
    const frac = h * 6 - sector
    const min = v * (1 - s)
    const desc = v * (1 - frac * s)
    const asc = v * (1 - (1 - frac) * s)

    let r = 0, g = 0, b = 0
    switch (sector % 6) {
      case 0: r = v;    g = asc;  b = min;  break
      case 1: r = desc; g = v;    b = min;  break
      case 2: r = min;  g = v;    b = asc;  break
      case 3: r = min;  g = desc; b = v;    break
      case 4: r = asc;  g = min;  b = v;    break
      case 5: r = v;    g = min;  b = desc; break
    }
    return {r, g, b}
  }
}
