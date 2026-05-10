import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {AutoColorCycler} from "Scripts/PeripheralLight/AutoColorCycler"

const LOG_TAG = "[GameLogicManager]"

@component
export class GameLogicManager extends BaseScriptComponent {
  @input
  @hint("Prefab with RenderMeshVisual for debug color display")
  debugMeshPrefab: ObjectPrefab

  @input
  @hint("Hue distance (0-0.5) the finger ball must exceed vs lamp color to count as contrasting")
  contrastThreshold: number = 0.3

  @input
  @hint("Hue distance (0-0.5) below which finger ball and lamp ball colors count as similar")
  similarityThreshold: number = 0.15

  @input
  @hint("Bypass color filters -- all collisions play sound regardless of color")
  quickTestMode: boolean = false

  private static instance: GameLogicManager

  private debugMeshes: RenderMeshVisual[] = []
  private debugMats: Material[] = []
  private debugVfxComponents: VFXComponent[] = []
  private currentLampColor: vec4 = new vec4(1, 1, 1, 1)
  private lastContrastingColor: vec4 = new vec4(1, 1, 1, 1)
  private cyclers: AutoColorCycler[] = []
  private gameStarted: boolean = false

  private _onGameStarted: Event<void> = new Event<void>()

  get onGameStarted() {
    return this._onGameStarted.publicApi()
  }

  static getInstance(): GameLogicManager | undefined {
    return GameLogicManager.instance
  }

  getCurrentLampColor(): vec4 {
    return this.currentLampColor
  }

  onAwake() {
    if (GameLogicManager.instance) {
      print(`${LOG_TAG} WARNING: Multiple instances detected, only one GameLogicManager should exist in the scene`)
    }
    GameLogicManager.instance = this
    print(`${LOG_TAG} Singleton initialized`)

    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    print(`${LOG_TAG} Ready — call registerDebugObject() to wire color display meshes`)
  }

  registerDebugObject(obj: SceneObject) {
    if (!obj) return

    // RenderMeshVisual path: clone the material so per-instance baseColor edits
    // don't bleed across other users of the same source material.
    const rmv = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    if (rmv) {
      const mat = rmv.mainMaterial.clone()
      rmv.mainMaterial = mat
      mat.mainPass.baseColor = this.lastContrastingColor
      this.debugMeshes.push(rmv)
      this.debugMats.push(mat)
    }

    // VFXComponent path: walk descendants because the VFXComponent is usually
    // mounted on a child, not the prefab root. The graph must expose a vec4
    // Simulate property named "particleColor" (see ColorHintVFX.vfxgraph).
    const vfx = this.findVfxComponent(obj)
    if (vfx) {
      this.debugVfxComponents.push(vfx)
      this.pushVfxColor(vfx, this.lastContrastingColor)
    }

    if (!rmv && !vfx) {
      print(`${LOG_TAG} WARNING: No RenderMeshVisual or VFXComponent on registered debug object "${obj.name}"`)
      return
    }

    print(`${LOG_TAG} Debug object registered: "${obj.name}" (meshes=${this.debugMeshes.length}, vfx=${this.debugVfxComponents.length})`)
  }

  private findVfxComponent(obj: SceneObject): VFXComponent | null {
    const direct = obj.getComponent("Component.VFXComponent") as VFXComponent
    if (direct) return direct
    const childCount = obj.getChildrenCount()
    for (let i = 0; i < childCount; i++) {
      const found = this.findVfxComponent(obj.getChild(i))
      if (found) return found
    }
    return null
  }

  private pushVfxColor(vfx: VFXComponent, color: vec4) {
    if (!vfx || !vfx.asset) return
    try {
      const props = vfx.asset.properties as any
      props["particleColor"] = color
    } catch (_) {
      // particleColor may not be exposed yet on this graph
    }
  }

  registerCycler(cycler: AutoColorCycler) {
    if (this.cyclers.indexOf(cycler) < 0) {
      this.cyclers.push(cycler)
      cycler.onColorCycled.add((color: vec4) => this.onColorCycled(color))
      print(`${LOG_TAG} AutoColorCycler registered`)
    } else {
      print(`${LOG_TAG} AutoColorCycler already registered`)
    }

    if (this.gameStarted) {
      cycler.startCycling()
    }
  }

  startGame() {
    if (this.gameStarted) {
      print(`${LOG_TAG} startGame ignored; game already started`)
      return
    }

    this.gameStarted = true
    print(`${LOG_TAG} Game started; enabling ${this.cyclers.length} color cycler(s)`)

    for (let i = 0; i < this.cyclers.length; i++) {
      this.cyclers[i].startCycling()
    }

    this._onGameStarted.invoke()
  }

  private onColorCycled(color: vec4) {
    this.currentLampColor = color

    const contrasting = this.getContrastingColor(color)
    this.lastContrastingColor = contrasting
    print(`${LOG_TAG} Original rgb(${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)}) -> Contrasting rgb(${contrasting.r.toFixed(2)}, ${contrasting.g.toFixed(2)}, ${contrasting.b.toFixed(2)})`)

    for (let i = 0; i < this.debugMats.length; i++) {
      if (this.debugMats[i]) {
        this.debugMats[i].mainPass.baseColor = contrasting
      }
    }

    for (let i = 0; i < this.debugVfxComponents.length; i++) {
      this.pushVfxColor(this.debugVfxComponents[i], contrasting)
    }
  }

  private getContrastingColor(color: vec4): vec4 {
    const hsv = this.rgbToHsv(color.r, color.g, color.b)
    const contrastingHue = (hsv.h + 0.5) % 1.0
    const rgb = this.hsvToRgb(contrastingHue, hsv.s, hsv.v)
    return new vec4(rgb.r, rgb.g, rgb.b, 1.0)
  }

  private rgbToHsv(r: number, g: number, b: number): {h: number; s: number; v: number} {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min

    let h = 0
    if (delta > 0) {
      if (max === r) {
        h = ((g - b) / delta) % 6
      } else if (max === g) {
        h = (b - r) / delta + 2
      } else {
        h = (r - g) / delta + 4
      }
      h = h / 6
      if (h < 0) h += 1
    }

    const s = max === 0 ? 0 : delta / max
    const v = max

    return {h, s, v}
  }

  getHueDistance(a: vec4, b: vec4): number {
    const hsvA = this.rgbToHsv(a.r, a.g, a.b)
    const hsvB = this.rgbToHsv(b.r, b.g, b.b)
    const diff = Math.abs(hsvA.h - hsvB.h)
    return Math.min(diff, 1.0 - diff)
  }

  areColorsContrasting(a: vec4, b: vec4): boolean {
    if (this.quickTestMode) return true
    return this.getHueDistance(a, b) > this.contrastThreshold
  }

  areColorsSimilar(a: vec4, b: vec4): boolean {
    if (this.quickTestMode) return true
    return this.getHueDistance(a, b) < this.similarityThreshold
  }

  static getObjectColor(obj: SceneObject): vec4 | null {
    const rmv = obj.getComponent("RenderMeshVisual") as RenderMeshVisual
    if (rmv && rmv.mainMaterial) {
      return rmv.mainMaterial.mainPass.baseColor
    }
    return null
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
