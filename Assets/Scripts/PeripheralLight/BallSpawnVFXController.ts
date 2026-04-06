const VFX_LOG = "[BallVFX]"


/**
 * Drives the Fresnel dissolve materialization on the ball's shader and
 * coordinates the surrounding particle burst VFX.
 *
 * Attach to the FingerBall prefab root. ColorPickController calls
 * startMaterialize() after instantiation and material clone.
 *
 * Shader graph (FresnelDissolve_ball.ss_graph) must expose these uniforms:
 *   materializeProgress  float   0-1
 *   fresnelPower         float   2-5
 *   emissionColor        vec4
 *   emissionIntensity    float   0-3+
 *
 * Lifecycle:
 *   1. Materializing  -- dissolve reveals sphere, emission fades to residual
 *   2. AwaitingColor  -- ball solid, subtle Fresnel glow persists
 *   3. ColorFadeOut   -- color received, Fresnel flashes new color then fades
 *   4. Done           -- emission off
 */
@component
export class BallSpawnVFXController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("VFXComponent on child SceneObject for surrounding particle burst")
  vfxComponent: VFXComponent

  @input
  @hint("Seconds for the full dissolve reveal (0 = instant)")
  materializeDuration: number = 0.8

  @input
  @hint("Fresnel edge falloff exponent (higher = thinner rim)")
  fresnelPower: number = 3.0

  @input
  @hint("Peak HDR emission glow during reveal")
  peakEmissionIntensity: number = 2.5

  @input
  @hint("Multiplier to brighten baseColor into emissionColor")
  emissionBoost: number = 1.5

  @input
  @hint("Fraction of peak emission kept while awaiting color (0-1)")
  residualEmission: number = 0.3

  @input
  @hint("Seconds for Fresnel glow to fade after color arrives")
  colorFadeDuration: number = 0.35

  @input
  @hint("Base alpha for the ball core (lower = more see-through center)")
  coreAlpha: number = 0.6

  @input
  @hint("Emission kept on the final colored ball (0 = no rim, 0.5 = subtle glow)")
  finalEmission: number = 0.4

  private ballMat: Material = null
  private progress: number = 0
  private animating: boolean = false
  private awaitingColor: boolean = false
  private fadingOut: boolean = false
  private fadeProgress: number = 0
  private residualIntensity: number = 0
  private color: vec4 = new vec4(0.5, 0.5, 0.5, 1)
  private updateBound: boolean = false

  startMaterialize(mat: Material, initialColor: vec4) {
    this.ballMat = mat
    this.color = initialColor
    this.progress = 0
    this.animating = true
    this.awaitingColor = false
    this.fadingOut = false
    this.fadeProgress = 0

    const pass = mat.mainPass
    pass.materializeProgress = 0
    pass.fresnelPower = this.fresnelPower
    pass.emissionColor = this.buildEmission(initialColor)
    pass.emissionIntensity = this.peakEmissionIntensity

    if (this.vfxComponent) {
      this.pushVfxColor(initialColor)
      this.vfxComponent.enabled = true
    }

    if (!this.updateBound) {
      this.createEvent("UpdateEvent").bind(() => this.tick())
      this.updateBound = true
    }

    print(`${VFX_LOG} Materialize started (duration=${this.materializeDuration}s)`)
  }

  updateColor(newColor: vec4) {
    this.color = newColor
    if (this.ballMat) {
      this.ballMat.mainPass.baseColor = new vec4(newColor.r, newColor.g, newColor.b, this.coreAlpha)
      this.ballMat.mainPass.emissionColor = this.buildEmission(newColor)
    }
    this.pushVfxColor(newColor)

    if (this.awaitingColor) {
      this.awaitingColor = false
      this.fadingOut = true
      this.fadeProgress = 0
      this.residualIntensity = this.peakEmissionIntensity * this.residualEmission
      print(`${VFX_LOG} Color received, fading Fresnel to final level`)
    }
  }

  forceComplete() {
    if (!this.animating && !this.awaitingColor && !this.fadingOut) return
    this.animating = false
    this.awaitingColor = false
    this.fadingOut = false
    this.progress = 1
    this.killEmission()
  }

  get isMaterialized(): boolean {
    return !this.animating
  }

  private tick() {
    if (!this.ballMat) return

    if (this.animating) {
      this.tickMaterialize()
      return
    }

    if (this.fadingOut) {
      this.tickColorFade()
    }
  }

  private tickMaterialize() {
    this.progress = Math.min(this.progress + getDeltaTime() / this.materializeDuration, 1.0)

    const t = this.progress
    const smooth = t * t * (3 - 2 * t)

    this.ballMat.mainPass.materializeProgress = smooth
    this.ballMat.mainPass.fresnelPower = this.fresnelPower * (1.0 - smooth * 0.6)

    const minEmission = this.peakEmissionIntensity * this.residualEmission
    const emFade = 1.0 - smooth * smooth
    const emValue = minEmission + (this.peakEmissionIntensity - minEmission) * emFade
    this.ballMat.mainPass.emissionIntensity = emValue

    if (this.progress >= 1.0) {
      this.finalizeMaterialize()
    }
  }

  private tickColorFade() {
    this.fadeProgress = Math.min(this.fadeProgress + getDeltaTime() / this.colorFadeDuration, 1.0)

    const t = this.fadeProgress
    const smooth = t * t * (3 - 2 * t)
    const target = this.peakEmissionIntensity * this.finalEmission
    this.ballMat.mainPass.emissionIntensity = target + (this.residualIntensity - target) * (1.0 - smooth)

    if (this.fadeProgress >= 1.0) {
      this.fadingOut = false
      this.ballMat.mainPass.emissionIntensity = target
      if (this.vfxComponent) {
        this.vfxComponent.enabled = false
      }
      print(`${VFX_LOG} Fresnel settled at final emission`)
    }
  }

  private finalizeMaterialize() {
    this.animating = false
    this.awaitingColor = true

    if (this.ballMat) {
      this.ballMat.mainPass.materializeProgress = 1.0
      this.ballMat.mainPass.fresnelPower = this.fresnelPower * 0.4
      this.ballMat.mainPass.emissionIntensity = this.peakEmissionIntensity * this.residualEmission
      this.applyAlpha(this.coreAlpha)
    }

    print(`${VFX_LOG} Materialize complete, awaiting color`)
  }

  private killEmission() {
    if (this.ballMat) {
      this.ballMat.mainPass.materializeProgress = 1.0
      this.ballMat.mainPass.emissionIntensity = 0
      this.applyAlpha(1.0)
    }
    if (this.vfxComponent) {
      this.vfxComponent.enabled = false
    }
  }

  private applyAlpha(alpha: number) {
    if (!this.ballMat) return
    const c = this.ballMat.mainPass.baseColor
    this.ballMat.mainPass.baseColor = new vec4(c.r, c.g, c.b, alpha)
  }

  private buildEmission(c: vec4): vec4 {
    const b = this.emissionBoost
    return new vec4(
      Math.min(1, c.r * b),
      Math.min(1, c.g * b),
      Math.min(1, c.b * b),
      1
    )
  }

  private pushVfxColor(c: vec4) {
    if (!this.vfxComponent || !this.vfxComponent.asset) return
    try {
      ;(this.vfxComponent.asset.properties as any)["particleColor"] = c
    } catch (_) {
      // property may not exist on the VFX graph yet
    }
  }
}
