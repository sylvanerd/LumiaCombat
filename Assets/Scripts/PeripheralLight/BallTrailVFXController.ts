const TRAIL_LOG = "[BallTrail]"

/**
 * Drives a swirling trail VFX behind the FingerBall after it is thrown.
 *
 * Attach to the FingerBall prefab root alongside BallSpawnVFXController.
 * ColorPickController calls startTrail() at pinch release (throw),
 * passing the ball's current base color.
 *
 * The VFX graph (BallTrailVFX.vfxgraph) must expose these Simulate properties:
 *   trailColor         vec4   — particle tint (emission-boosted ball color)
 *   emissionIntensity  float  — HDR multiplier for glow
 *
 * Lifecycle:
 *   1. Idle        — VFXComponent disabled, waiting for throw
 *   2. Trailing    — VFX enabled, color/emission pushed each frame
 *   3. Fading      — after trailFadeDelay, emission ramps down over trailFadeDuration
 *   4. Stopped     — VFXComponent disabled, no further updates
 */
@component
export class BallTrailVFXController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("VFXComponent on the TrailVFX child SceneObject")
  trailVfxComponent: VFXComponent

  @input
  @hint("Multiplier applied to the ball base color for the trail (>1 = brighter/emission)")
  trailEmissionBoost: number = 2.0

  @input
  @hint("HDR emission intensity pushed to the VFX graph")
  emissionIntensity: number = 2.5

  @input
  @hint("Seconds after throw before trail starts fading")
  trailFadeDelay: number = 3.0

  @input
  @hint("Seconds for the emission fade-out to zero")
  trailFadeDuration: number = 1.0

  @input
  @hint("Max seconds the trail lives after throw (hard stop)")
  autoStopAfter: number = 5.0

  private active: boolean = false
  private fading: boolean = false
  private elapsedSinceThrow: number = 0
  private fadeProgress: number = 0
  private peakIntensity: number = 0
  private baseColor: vec4 = new vec4(1, 1, 1, 1)
  private updateBound: boolean = false

  startTrail(ballColor: vec4) {
    if (!this.trailVfxComponent) {
      print(`${TRAIL_LOG} No trailVfxComponent assigned — skipping trail`)
      return
    }

    this.baseColor = ballColor
    this.peakIntensity = this.emissionIntensity
    this.elapsedSinceThrow = 0
    this.fadeProgress = 0
    this.fading = false
    this.active = true

    this.pushTrailProperties(ballColor, this.peakIntensity)
    this.trailVfxComponent.enabled = true

    if (!this.updateBound) {
      this.createEvent("UpdateEvent").bind(() => this.tick())
      this.updateBound = true
    }

    print(`${TRAIL_LOG} Trail started — boost=${this.trailEmissionBoost}, emission=${this.peakIntensity}`)
  }

  stopTrail() {
    if (!this.active) return
    this.active = false
    this.fading = false

    if (this.trailVfxComponent) {
      this.trailVfxComponent.enabled = false
    }

    print(`${TRAIL_LOG} Trail stopped`)
  }

  private tick() {
    if (!this.active) return

    const dt = getDeltaTime()
    this.elapsedSinceThrow += dt

    if (this.elapsedSinceThrow >= this.autoStopAfter) {
      this.stopTrail()
      return
    }

    if (!this.fading && this.elapsedSinceThrow >= this.trailFadeDelay) {
      this.fading = true
      this.fadeProgress = 0
      print(`${TRAIL_LOG} Fade-out started`)
    }

    if (this.fading) {
      this.fadeProgress = Math.min(this.fadeProgress + dt / this.trailFadeDuration, 1.0)
      const t = this.fadeProgress
      const smooth = t * t * (3 - 2 * t)
      const currentIntensity = this.peakIntensity * (1.0 - smooth)

      this.pushTrailProperties(this.baseColor, currentIntensity)

      if (this.fadeProgress >= 1.0) {
        this.stopTrail()
      }
    }
  }

  private pushTrailProperties(color: vec4, intensity: number) {
    if (!this.trailVfxComponent || !this.trailVfxComponent.asset) return
    try {
      const props = this.trailVfxComponent.asset.properties as any
      const boost = this.trailEmissionBoost
      const emColor = new vec4(
        Math.min(1, color.r * boost),
        Math.min(1, color.g * boost),
        Math.min(1, color.b * boost),
        1
      )
      props["trailColor"] = emColor
      props["emissionIntensity"] = intensity
    } catch (_) {
      // VFX graph properties may not be defined yet
    }
  }
}
