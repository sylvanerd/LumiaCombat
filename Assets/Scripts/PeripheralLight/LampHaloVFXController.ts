import {GameLogicManager} from "Scripts/GameLogicManager"
import {AutoColorCycler} from "./AutoColorCycler"
import {LampHealthManager} from "./LampHealthManager"

const LOG_TAG = "[LampHaloVFXController]"

/**
 * Drives the halo VFX embedded inside LampHeathBarRoot.prefab.
 *
 * Lifecycle:
 *   - OnStartEvent: try to resolve LampHealthManager + AutoColorCycler singletons.
 *     If either is missing (script-ordering race), fall back to an UpdateEvent poll.
 *   - Once both are resolved, subscribe to onColorCycled / onHealthChanged / onLampDied,
 *     then kick the VFX once immediately using GameLogicManager.getCurrentLampColor()
 *     so the halo is visible the moment the prefab spawns instead of waiting up to
 *     5 seconds for the next color cycle.
 *
 * The VFX graph (LampHaloVFX.vfxgraph) must expose two Simulate properties:
 *   particleColor          vec4   the halo tint
 *   particleEmissionBoost  float  emission multiplier applied in the graph
 *
 * Restart primitive: toggling VFXComponent.enabled false -> true re-fires the
 * Spawn Burst from frame 0, matching the pattern used in BallSpawnVFXController.
 */
@component
export class LampHaloVFXController extends BaseScriptComponent {
  @input
  @hint("VFXComponent on the sibling Halo SceneObject (LampHaloVFX.vfxgraph)")
  vfxComponent: VFXComponent

  @input
  @hint("Multiplier pushed to the graph's particleEmissionBoost property")
  emissionBoost: number = 1.5

  @input
  @hint("Minimum seconds between consecutive restart kicks (debounces stacked hits)")
  restartCooldownSeconds: number = 0.1

  private healthMgr: LampHealthManager
  private cycler: AutoColorCycler
  private lastRestart: number = -999
  private subscribed: boolean = false
  private retryEvent: SceneEvent

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.tryBind())
  }

  private tryBind() {
    this.healthMgr = LampHealthManager.getInstance() as LampHealthManager
    this.cycler = AutoColorCycler.getInstance() as AutoColorCycler

    if (this.healthMgr && this.cycler) {
      this.subscribe()
      return
    }

    print(`${LOG_TAG} Singletons not ready yet (health=${!!this.healthMgr}, cycler=${!!this.cycler}); polling`)
    this.retryEvent = this.createEvent("UpdateEvent")
    this.retryEvent.bind(() => this.retryBind())
  }

  private retryBind() {
    if (!this.healthMgr) this.healthMgr = LampHealthManager.getInstance() as LampHealthManager
    if (!this.cycler) this.cycler = AutoColorCycler.getInstance() as AutoColorCycler

    if (this.healthMgr && this.cycler) {
      if (this.retryEvent) this.retryEvent.enabled = false
      this.subscribe()
    }
  }

  private subscribe() {
    if (this.subscribed) return
    this.subscribed = true

    this.cycler.onColorCycled.add((c: vec4) => this.onColorCycled(c))
    this.healthMgr.onHealthChanged.add((p: number) => this.onHealthChanged(p))
    this.healthMgr.onLampDied.add(() => this.onLampDied())

    const initialColor = this.resolveInitialColor()
    this.pushColor(initialColor)
    this.kickRestart(true)
    print(`${LOG_TAG} Subscribed; initial color rgb(${initialColor.r.toFixed(2)}, ${initialColor.g.toFixed(2)}, ${initialColor.b.toFixed(2)})`)
  }

  private resolveInitialColor(): vec4 {
    const manager = GameLogicManager.getInstance()
    if (manager) {
      return manager.getCurrentLampColor()
    }
    return new vec4(1, 1, 1, 1)
  }

  private onColorCycled(color: vec4) {
    if (!this.healthMgr.isAlive()) return
    this.pushColor(color)
    this.kickRestart()
  }

  private onHealthChanged(_p: number) {
    if (!this.healthMgr.isAlive()) return
    this.kickRestart()
  }

  private onLampDied() {
    print(`${LOG_TAG} Lamp died; halo will fade out naturally as last burst expires`)
  }

  private kickRestart(force: boolean = false) {
    const now = getTime()
    if (!force && now - this.lastRestart < this.restartCooldownSeconds) return
    this.lastRestart = now

    if (!this.vfxComponent) {
      print(`${LOG_TAG} WARNING: vfxComponent not wired; cannot restart`)
      return
    }

    this.vfxComponent.enabled = false
    this.vfxComponent.enabled = true
  }

  private pushColor(c: vec4) {
    if (!this.vfxComponent || !this.vfxComponent.asset) return
    try {
      const props = this.vfxComponent.asset.properties as any
      props["particleColor"] = c
      props["particleEmissionBoost"] = this.emissionBoost
    } catch (_) {
      // particleColor / particleEmissionBoost may not be exposed on the graph yet
    }
  }
}
