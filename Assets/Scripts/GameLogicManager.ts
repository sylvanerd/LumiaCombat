import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {AutoColorCycler} from "Scripts/PeripheralLight/AutoColorCycler"
import {ColorHistoryRing} from "Scripts/PeripheralLight/ColorHistoryRing"
import {LampHealthManager} from "Scripts/PeripheralLight/LampHealthManager"
import {LightHandInputManager} from "Scripts/PeripheralLight/LightHandInputManager"
import {PlayerHealthManager} from "Scripts/PeripheralLight/PlayerHealthManager"

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

  // ---------------------------------------------------------------------------
  // End-state orchestration
  // ---------------------------------------------------------------------------
  @ui.separator
  @ui.label("End-state orchestration")

  @input
  @allowUndefined
  @hint("Main camera SceneObject. Used to spawn the win confetti in front of the player.")
  mainCam: SceneObject

  @input
  @allowUndefined
  @hint("Multi-color confetti VFX prefab spawned in front of the player on win")
  confettiPrefab: ObjectPrefab

  @input
  @hint("Distance (cm) in front of the camera to spawn the confetti VFX")
  winConfettiDistance: number = 80

  @input
  @hint("Brief pause in seconds between lamp death and the confetti burst")
  winPauseSeconds: number = 1.0

  // ColorHistoryRing (the root of ColorHistoryBar.prefab) is instantiated at
  // runtime by ArmFlipPrefabSpawner, so it can't be wired via @input. We
  // resolve it through ColorHistoryRing.getInstance() instead. Disabling the
  // ring's SceneObject also disables the ColorHistoryBar child.

  @input
  @allowUndefined
  @hint("ColorPickPinchDetector SceneObject -- disabled before the light is placed and re-disabled on lose so fresh extraction stays off")
  pinchDetector: SceneObject

  @input
  @allowUndefined
  @hint("LightHandInputManager -- source of the onLightPlaced event that unlocks color extraction")
  lightHandInputManager: LightHandInputManager

  @input
  @allowUndefined
  @hint("Victory sting played when the lamp is defeated")
  victorySound: AudioComponent

  @input
  @allowUndefined
  @hint("Defeat sting played when the player is defeated")
  defeatSound: AudioComponent

  private static instance: GameLogicManager

  private debugMeshes: RenderMeshVisual[] = []
  private debugMats: Material[] = []
  private debugVfxComponents: VFXComponent[] = []
  private currentLampColor: vec4 = new vec4(1, 1, 1, 1)
  private lastContrastingColor: vec4 = new vec4(1, 1, 1, 1)
  private cyclers: AutoColorCycler[] = []
  private gameStarted: boolean = false
  private isGameOver: boolean = false
  // Tracks whether LightHandInputManager has emitted onLightPlaced at least
  // once. Used by restartGame() to decide whether to re-enable extraction:
  // restart with no placement yet shouldn't open the gate.
  private isLightPlaced: boolean = false

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

    // Color extraction stays off until the light is placed. We disable only the
    // pinch detector here, not the full extraction set: ColorHistoryRing isn't
    // spawned until placement (ArmFlipPrefabSpawner gates it on
    // surfaceDetectionPosition), so toggling it now would just log a missing-
    // singleton warning. handleLose / restartGame use setExtractionEnabled for
    // the full symmetric toggle once the ring exists.
    this.setSceneObjectEnabled(this.pinchDetector, false)

    if (this.lightHandInputManager) {
      this.lightHandInputManager.onLightPlaced.add(() => this.onLightPlaced())
    } else {
      print(`${LOG_TAG} WARNING: lightHandInputManager not wired -- color extraction will remain disabled. Wire it in the Inspector to unlock extraction on placement.`)
    }

    // Subscribe to end-state events from the two health managers. Both are scene
    // singletons that registered themselves in their onAwake, which runs before
    // any OnStartEvent, so getInstance() is reliably non-null here.
    const lamp = LampHealthManager.getInstance()
    if (lamp) {
      lamp.onLampDied.add(() => this.handleWin())
    } else {
      print(`${LOG_TAG} WARNING: LampHealthManager singleton not found -- win flow disabled`)
    }

    const player = PlayerHealthManager.getInstance()
    if (player) {
      player.onPlayerDied.add(() => this.handleLose())
    } else {
      print(`${LOG_TAG} WARNING: PlayerHealthManager singleton not found -- lose flow disabled`)
    }
  }

  private onLightPlaced() {
    if (this.isLightPlaced) return
    this.isLightPlaced = true
    print(`${LOG_TAG} Light placed -- enabling color extraction`)
    // Only open the gate if the game isn't already in a terminal lose state.
    // (Unreachable today since lose can only happen post-placement, but the
    // guard keeps restart/lose ordering safe for future flows.)
    if (!this.isGameOver) {
      this.setExtractionEnabled(true)
    }
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

  // ---------------------------------------------------------------------------
  // End-state orchestration
  // ---------------------------------------------------------------------------

  /**
   * Lamp defeated. The cycler + bulb are already stopped by LampHealthManager.die(),
   * and AutoBallShooter starves once the cycler stops, so nothing else needs to be
   * disabled. We just pause briefly for a moment of silence, then spawn the confetti
   * in front of the player. Free play continues.
   */
  private handleWin() {
    if (this.isGameOver) return
    this.isGameOver = true
    print(`${LOG_TAG} Win -- scheduling confetti in ${this.winPauseSeconds.toFixed(2)}s`)

    if (this.victorySound) this.victorySound.play(1)

    const delay = this.createEvent("DelayedCallbackEvent")
    delay.bind(() => this.spawnWinConfetti())
    delay.reset(this.winPauseSeconds)
  }

  /**
   * Player died. Stop the lamp's cycler ourselves (LampHealthManager.die does NOT
   * run on player death), which also starves AutoBallShooter of onColorCycled
   * events. Then shut down both fresh extraction and saved-color throws by
   * disabling the pinch detector and the ColorHistoryRing SceneObject (which
   * also disables its ColorHistoryBar child).
   */
  private handleLose() {
    if (this.isGameOver) return
    this.isGameOver = true
    print(`${LOG_TAG} Lose -- stopping cyclers, disabling color inputs`)

    if (this.defeatSound) this.defeatSound.play(1)

    for (let i = 0; i < this.cyclers.length; i++) {
      this.cyclers[i].stopCycling()
    }

    this.setExtractionEnabled(false)
  }

  /**
   * Entry point for a future "Restart" UI button. Symmetric inverse of
   * handleLose: clears the game-over latch, resumes cyclers, and re-opens the
   * color-extraction gate -- but only if the light has actually been placed.
   * Health-manager resets (LampHealthManager.reset / PlayerHealthManager.reset)
   * and any hand-VFX restore should be invoked here too as the rest of the
   * restart flow gets wired up.
   */
  public restartGame() {
    if (!this.isGameOver) {
      print(`${LOG_TAG} restartGame ignored; not in a game-over state`)
      return
    }
    this.isGameOver = false
    print(`${LOG_TAG} Restart -- resuming cyclers, re-enabling color inputs (isLightPlaced=${this.isLightPlaced})`)

    for (let i = 0; i < this.cyclers.length; i++) {
      this.cyclers[i].startCycling()
    }

    if (this.isLightPlaced) {
      this.setExtractionEnabled(true)
    }
  }

  // Single toggle for every "color extraction" path: fresh Gemini extraction
  // (pinchDetector SceneObject) and saved-color throws (ColorHistoryRing
  // SceneObject, which also gates its ColorHistoryBar child). All three states
  // -- pre-placement, lose, and the post-lose restart -- run through here.
  private setExtractionEnabled(enabled: boolean) {
    this.setSceneObjectEnabled(this.pinchDetector, enabled)
    this.setColorHistoryRingEnabled(enabled)
  }

  private spawnWinConfetti() {
    if (!this.confettiPrefab) {
      print(`${LOG_TAG} WARNING: confettiPrefab not wired -- skipping win VFX`)
      return
    }
    if (!this.mainCam) {
      print(`${LOG_TAG} WARNING: mainCam not wired -- skipping win VFX`)
      return
    }

    // ColorPickController treats the camera's negated forward as "into the scene"
    // (see onPinchRelease). Mirror that convention so the confetti appears in
    // front of the player rather than behind them.
    const camTrans = this.mainCam.getTransform()
    const camPos = camTrans.getWorldPosition()
    const camForward = camTrans.forward.uniformScale(-1)
    const spawnPos = camPos.add(camForward.uniformScale(this.winConfettiDistance))

    const fx = this.confettiPrefab.instantiate(null)
    fx.getTransform().setWorldPosition(spawnPos)
    print(`${LOG_TAG} Confetti spawned at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)})`)
  }

  private setSceneObjectEnabled(obj: SceneObject, enabled: boolean) {
    if (obj) obj.enabled = enabled
  }

  // ColorHistoryRing self-registers as a singleton because its prefab is
  // instantiated at runtime by ArmFlipPrefabSpawner. Disabling the ring's root
  // SceneObject also disables the ColorHistoryBar child, killing both the
  // color-hint touch path and the saved-color throw path with one toggle.
  private setColorHistoryRingEnabled(enabled: boolean) {
    const ring = ColorHistoryRing.getInstance()
    if (ring) {
      ring.getSceneObject().enabled = enabled
    } else {
      print(`${LOG_TAG} WARNING: ColorHistoryRing singleton not found -- skipping enabled=${enabled}`)
    }
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
