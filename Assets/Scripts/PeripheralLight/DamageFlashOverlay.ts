/**
 * DamageFlashOverlay
 *
 * Tints a camera-anchored vignette plane to the colour of whatever just hit the
 * player and fades it back to invisible. Subscribes to
 * PlayerHealthManager.onDamageFlash, which only fires when damage actually
 * lands (not when blocked by invincibility), so the visual stays in sync with
 * the health drop.
 *
 * The plane's RenderMeshVisual is expected to use a textured unlit material
 * (clone of MainUI.mat) with BlendMode=PremultipliedAlphaAuto and a vignette
 * PNG in baseTex. The PNG's alpha channel defines the SHAPE of the flash; this
 * script drives baseColor.rgb (tint) and baseColor.a (intensity over time).
 */

import {PlayerHealthManager} from "./PlayerHealthManager"

const LOG_TAG = "[DamageFlashOverlay]"

@component
export class DamageFlashOverlay extends BaseScriptComponent {
  @input
  @hint("RenderMeshVisual on the camera-anchored plane. Its mainMaterial will be cloned at runtime so per-instance edits don't leak to other meshes sharing the source material.")
  targetVisual: RenderMeshVisual

  @input
  @hint("Seconds for the flash to decay from peakAlpha back to 0")
  flashDuration: number = 0.5

  @input
  @hint("Peak alpha applied at the instant of the hit (0..1). Lower = subtler flash.")
  peakAlpha: number = 0.5

  private overlayMat: Material
  private healthManager: PlayerHealthManager
  private subscribed: boolean = false

  private flashStartTime: number = -1
  private currentColor: vec3 = new vec3(1, 1, 1)
  private updateEvent: UpdateEvent

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    if (!this.targetVisual) {
      print(`${LOG_TAG} WARNING: targetVisual not wired in Inspector`)
      return
    }

    this.overlayMat = this.targetVisual.mainMaterial.clone()
    this.targetVisual.mainMaterial = this.overlayMat
    // Force invisible at scene load regardless of what the source material had.
    const c = this.overlayMat.mainPass.baseColor
    this.overlayMat.mainPass.baseColor = new vec4(c.r, c.g, c.b, 0)

    this.updateEvent = this.createEvent("UpdateEvent")
    this.updateEvent.bind(() => this.onUpdate())
    this.updateEvent.enabled = false

    this.trySubscribe()
    if (!this.subscribed) {
      // Late-binding fallback: keep polling on the global UpdateEvent until the
      // PlayerHealthManager singleton is available (same pattern as
      // CircularHealthBar). We reuse the same update event since it's disabled
      // outside of an active flash anyway.
      this.updateEvent.enabled = true
    }

    print(`${LOG_TAG} Initialized, flashDuration=${this.flashDuration}s, peakAlpha=${this.peakAlpha}`)
  }

  private trySubscribe(): boolean {
    if (this.subscribed) return true
    const mgr = PlayerHealthManager.getInstance()
    if (!mgr) return false
    this.healthManager = mgr
    this.healthManager.onDamageFlash.add((color: vec4) => this.onDamageFlash(color))
    this.subscribed = true
    print(`${LOG_TAG} Subscribed to PlayerHealthManager.onDamageFlash`)
    return true
  }

  private onDamageFlash(color: vec4) {
    this.currentColor = new vec3(color.r, color.g, color.b)
    this.flashStartTime = getTime()
    this.overlayMat.mainPass.baseColor = new vec4(color.r, color.g, color.b, this.peakAlpha)
    this.updateEvent.enabled = true
  }

  private onUpdate() {
    if (!this.subscribed) {
      if (this.trySubscribe() && this.flashStartTime < 0) {
        // No active flash and we just bound the subscription — stop updating
        // until a real flash comes in.
        this.updateEvent.enabled = false
      }
      return
    }

    if (this.flashStartTime < 0) {
      this.updateEvent.enabled = false
      return
    }

    const elapsed = getTime() - this.flashStartTime
    const t = Math.min(1, elapsed / Math.max(0.0001, this.flashDuration))
    // Smoothstep ease-out so the flash peaks instantly and tapers off
    const eased = 1 - (t * t * (3 - 2 * t))
    const alpha = this.peakAlpha * eased

    this.overlayMat.mainPass.baseColor = new vec4(
      this.currentColor.x,
      this.currentColor.y,
      this.currentColor.z,
      alpha
    )

    if (t >= 1) {
      this.overlayMat.mainPass.baseColor = new vec4(this.currentColor.x, this.currentColor.y, this.currentColor.z, 0)
      this.flashStartTime = -1
      this.updateEvent.enabled = false
    }
  }
}
