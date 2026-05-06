const VFX_LOG = "[BallVFX]"
const EMISSION_BOOST = 1.5
const RESIDUAL_EMISSION = 0.3


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
 *   3. Done           -- color received, final Fresnel emission persists
 */
@component
export class BallSpawnVFXController extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("VFXComponent on child SceneObject for surrounding particle burst")
  vfxComponent: VFXComponent

  @input
  @hint("Emission multiplier for spawn particles only")
  particleEmissionBoost: number = 2.0

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
  @hint("Final alpha for the ball core after materialization")
  coreAlpha: number = 1.0

  @input
  @hint("Emission kept on the final colored ball (0 = no rim, 0.5 = subtle glow)")
  finalEmission: number = 0.4

  @input
  @hint("Seconds for extracted color to blend from placeholder to final color")
  colorFillDuration: number = 0.5

  private ballMat: Material = null
  private progress: number = 0
  private animating: boolean = false
  private awaitingColor: boolean = false
  private colorFilling: boolean = false
  private colorFillProgress: number = 0
  private colorFillStartColor: vec4 = new vec4(0.5, 0.5, 0.5, 1)
  private colorFillTargetColor: vec4 = new vec4(0.5, 0.5, 0.5, 1)
  private color: vec4 = new vec4(0.5, 0.5, 0.5, 1)
  private updateBound: boolean = false

  startMaterialize(mat: Material, initialColor: vec4) {
    this.ballMat = mat
    this.color = initialColor
    this.progress = 0
    this.animating = true
    this.awaitingColor = false
    this.colorFilling = false
    this.colorFillProgress = 0

    const pass = mat.mainPass
    pass.materializeProgress = 0
    pass.baseColor = new vec4(initialColor.r, initialColor.g, initialColor.b, 0)
    pass.fresnelPower = this.fresnelPower
    pass.emissionColor = this.buildEmission(initialColor)
    pass.emissionIntensity = this.peakEmissionIntensity

    if (this.vfxComponent) {
      this.vfxComponent.enabled = false
    }

    if (!this.updateBound) {
      this.createEvent("UpdateEvent").bind(() => this.tick())
      this.updateBound = true
    }

    print(`${VFX_LOG} Materialize started (duration=${this.materializeDuration}s)`)
  }

  updateColor(newColor: vec4) {
    if (this.ballMat) {
      const current = this.ballMat.mainPass.baseColor
      this.colorFillStartColor = new vec4(current.r, current.g, current.b, current.a)
      this.colorFillTargetColor = new vec4(newColor.r, newColor.g, newColor.b, this.coreAlpha)
      this.colorFillProgress = 0
      this.colorFilling = this.colorFillDuration > 0

      if (!this.colorFilling) {
        this.color = newColor
        this.ballMat.mainPass.baseColor = new vec4(newColor.r, newColor.g, newColor.b, current.a)
        this.ballMat.mainPass.emissionColor = this.buildEmission(newColor)
      }
    }
    this.pushVfxColor(newColor)
    if (this.vfxComponent) {
      this.vfxComponent.enabled = true
    }

    if (this.awaitingColor) {
      this.awaitingColor = false
      if (this.ballMat) {
        this.ballMat.mainPass.emissionIntensity = this.peakEmissionIntensity * this.finalEmission
      }
      print(`${VFX_LOG} Color received, Fresnel settled at final emission`)
    }
  }

  forceComplete() {
    if (!this.animating && !this.awaitingColor) return
    this.animating = false
    this.awaitingColor = false
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
    }

    if (this.colorFilling) {
      this.tickColorFill()
    }
  }

  private tickMaterialize() {
    this.progress = Math.min(this.progress + getDeltaTime() / this.materializeDuration, 1.0)

    const t = this.progress
    const smooth = t * t * (3 - 2 * t)

    this.ballMat.mainPass.materializeProgress = smooth
    this.ballMat.mainPass.baseColor = new vec4(this.color.r, this.color.g, this.color.b, smooth * this.coreAlpha)
    this.ballMat.mainPass.fresnelPower = this.fresnelPower * (1.0 - smooth * 0.6)

    const minEmission = this.peakEmissionIntensity * RESIDUAL_EMISSION
    const emFade = 1.0 - smooth * smooth
    const emValue = minEmission + (this.peakEmissionIntensity - minEmission) * emFade
    this.ballMat.mainPass.emissionIntensity = emValue

    if (this.progress >= 1.0) {
      this.finalizeMaterialize()
    }
  }

  private finalizeMaterialize() {
    this.animating = false
    this.awaitingColor = true

    if (this.ballMat) {
      this.ballMat.mainPass.materializeProgress = 1.0
      this.ballMat.mainPass.fresnelPower = this.fresnelPower * 0.4
      this.ballMat.mainPass.emissionIntensity = this.peakEmissionIntensity * RESIDUAL_EMISSION
      this.applyAlpha(this.coreAlpha)
    }

    print(`${VFX_LOG} Materialize complete, awaiting color`)
  }

  private tickColorFill() {
    this.colorFillProgress = Math.min(this.colorFillProgress + getDeltaTime() / this.colorFillDuration, 1.0)

    const t = this.colorFillProgress
    const smooth = t * t * (3 - 2 * t)
    const currentAlpha = this.ballMat.mainPass.baseColor.a
    const blended = new vec4(
      this.colorFillStartColor.r + (this.colorFillTargetColor.r - this.colorFillStartColor.r) * smooth,
      this.colorFillStartColor.g + (this.colorFillTargetColor.g - this.colorFillStartColor.g) * smooth,
      this.colorFillStartColor.b + (this.colorFillTargetColor.b - this.colorFillStartColor.b) * smooth,
      currentAlpha
    )

    this.color = blended
    this.ballMat.mainPass.baseColor = blended
    this.ballMat.mainPass.emissionColor = this.buildEmission(blended)

    if (this.colorFillProgress >= 1.0) {
      this.colorFilling = false
      this.color = this.colorFillTargetColor
      this.ballMat.mainPass.baseColor = new vec4(
        this.colorFillTargetColor.r,
        this.colorFillTargetColor.g,
        this.colorFillTargetColor.b,
        currentAlpha
      )
      this.ballMat.mainPass.emissionColor = this.buildEmission(this.colorFillTargetColor)
      print(`${VFX_LOG} Extracted color fill complete`)
    }
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
    return new vec4(
      Math.min(1, c.r * EMISSION_BOOST),
      Math.min(1, c.g * EMISSION_BOOST),
      Math.min(1, c.b * EMISSION_BOOST),
      1
    )
  }

  private pushVfxColor(c: vec4) {
    if (!this.vfxComponent || !this.vfxComponent.asset) return
    try {
      const props = this.vfxComponent.asset.properties as any
      props["particleColor"] = c
      props["particleEmissionBoost"] = this.particleEmissionBoost
    } catch (_) {
      // property may not exist on the VFX graph yet
    }
  }
}
