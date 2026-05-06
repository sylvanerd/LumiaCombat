const LOG_TAG = "[ContourVFX]"
const TWO_PI = 2 * Math.PI

enum ContourState {
  Idle,
  Extracting,
  ColorTransitioning
}

@component
export class HandVFXController extends BaseScriptComponent {
  @input
  @hint("The HandContour material asset (cloned per hand at startup)")
  latticeMaterial: Material

  @input
  @hint("Left hand's handMeshFull RenderMeshVisual from SIK HandVisual")
  leftHandMeshFull: RenderMeshVisual

  @input
  @hint("Right hand's handMeshFull RenderMeshVisual from SIK HandVisual")
  rightHandMeshFull: RenderMeshVisual

  @ui.separator
  @ui.label("Emission")

  @input
  @hint("HDR emission intensity at idle (>1.0 for glow)")
  idleEmission: number = 1.5

  @input
  @hint("Peak HDR emission intensity during pulse")
  pulseEmission: number = 2.5

  @ui.separator
  @ui.label("Pulse & Transition")

  @input
  @hint("Pulse oscillation frequency in Hz during extraction")
  pulseFrequency: number = 3.0

  @input
  @hint("Duration in seconds for color transition after detection")
  transitionDuration: number = 0.5

  private leftMat: Material
  private rightMat: Material

  private state: ContourState = ContourState.Idle

  private currentBaseColor: vec4 = new vec4(0.25, 0.25, 0.25, 0.5)
  private currentContourColor: vec4 = new vec4(0.7, 0.7, 0.7, 1.0)

  private targetBaseColor: vec4 = null
  private targetContourColor: vec4 = null
  private startBaseColor: vec4 = null
  private startContourColor: vec4 = null
  private transitionProgress: number = 0

  private readonly INITIAL_BASE_COLOR = new vec4(0.25, 0.25, 0.25, 0.5)
  private readonly INITIAL_CONTOUR_COLOR = new vec4(0.7, 0.7, 0.7, 1.0)
  private readonly BASE_DIM_FACTOR = 0.4

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    if (!this.latticeMaterial) {
      print(`${LOG_TAG} ERROR: latticeMaterial not assigned`)
      return
    }

    this.leftMat = this.latticeMaterial.clone()
    this.rightMat = this.latticeMaterial.clone()

    if (this.leftHandMeshFull) {
      this.leftHandMeshFull.mainMaterial = this.leftMat
      print(`${LOG_TAG} Contour material applied to left hand`)
    }
    if (this.rightHandMeshFull) {
      this.rightHandMeshFull.mainMaterial = this.rightMat
      print(`${LOG_TAG} Contour material applied to right hand`)
    }

    this.initMaterial(this.leftMat)
    this.initMaterial(this.rightMat)

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    print(`${LOG_TAG} Initialized — idleEmission=${this.idleEmission}, pulseEmission=${this.pulseEmission}, pulseHz=${this.pulseFrequency}`)
  }

  private initMaterial(mat: Material) {
    const pass = mat.mainPass
    pass.baseColor = this.currentBaseColor
    pass.contourColor = this.currentContourColor
    pass.emissionIntensity = this.idleEmission
    pass.pulsePhase = 0
    pass.pulseStrength = 0
  }

  /** Called by ColorPickController when pinch-hold triggers color extraction. */
  startExtraction() {
    this.state = ContourState.Extracting
    print(`${LOG_TAG} State -> Extracting (pulse started)`)
  }

  /** Called by ColorPickController when Gemini returns a detected color. */
  applyColor(color: vec4) {
    this.targetBaseColor = new vec4(
      color.r * this.BASE_DIM_FACTOR,
      color.g * this.BASE_DIM_FACTOR,
      color.b * this.BASE_DIM_FACTOR,
      0.5
    )
    this.targetContourColor = new vec4(color.r, color.g, color.b, 1.0)

    this.startBaseColor = new vec4(
      this.currentBaseColor.r, this.currentBaseColor.g,
      this.currentBaseColor.b, this.currentBaseColor.a
    )
    this.startContourColor = new vec4(
      this.currentContourColor.r, this.currentContourColor.g,
      this.currentContourColor.b, this.currentContourColor.a
    )
    this.transitionProgress = 0

    this.state = ContourState.ColorTransitioning
    print(`${LOG_TAG} State -> ColorTransitioning (color: ${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)})`)
  }

  /** Called by ColorPickController if pinch is released before color arrives. */
  cancelExtraction() {
    if (this.state !== ContourState.Extracting) return

    this.state = ContourState.Idle
    this.setOnBoth("pulseStrength", 0)
    this.setOnBoth("emissionIntensity", this.idleEmission)
    print(`${LOG_TAG} State -> Idle (extraction cancelled)`)
  }

  private onUpdate() {
    if (this.state === ContourState.Idle) return

    if (this.state === ContourState.Extracting) {
      this.tickExtracting()
    } else if (this.state === ContourState.ColorTransitioning) {
      this.tickColorTransitioning()
    }
  }

  private tickExtracting() {
    const pulse = Math.sin(getTime() * this.pulseFrequency * TWO_PI)
    this.writePulse(this.leftMat, pulse)
    this.writePulse(this.rightMat, pulse)
  }

  private tickColorTransitioning() {
    this.transitionProgress += getDeltaTime() / this.transitionDuration
    const t = Math.min(this.transitionProgress, 1.0)
    const smooth = t * t * (3 - 2 * t)

    this.currentBaseColor = this.lerpColor(this.startBaseColor, this.targetBaseColor, smooth)
    this.currentContourColor = this.lerpColor(this.startContourColor, this.targetContourColor, smooth)

    this.setOnBoth("baseColor", this.currentBaseColor)
    this.setOnBoth("contourColor", this.currentContourColor)

    const pulse = Math.sin(getTime() * this.pulseFrequency * TWO_PI)
    const fadingStrength = 1.0 - smooth
    this.setOnBoth("pulsePhase", pulse)
    this.setOnBoth("pulseStrength", fadingStrength)

    const blendedEmission = this.pulseEmission + (this.idleEmission - this.pulseEmission) * smooth
    this.setOnBoth("emissionIntensity", blendedEmission)

    if (t >= 1.0) {
      this.state = ContourState.Idle
      this.settleToIdle(this.leftMat)
      this.settleToIdle(this.rightMat)
      print(`${LOG_TAG} State -> Idle (color transition complete)`)
    }
  }

  private writePulse(mat: Material, pulsePhase: number) {
    const pass = mat.mainPass
    pass.pulsePhase = pulsePhase
    pass.pulseStrength = 1.0
    pass.emissionIntensity = this.pulseEmission
  }

  private settleToIdle(mat: Material) {
    const pass = mat.mainPass
    pass.baseColor = this.currentBaseColor
    pass.contourColor = this.currentContourColor
    pass.pulsePhase = 0
    pass.pulseStrength = 0
    pass.emissionIntensity = this.idleEmission
  }

  private lerpColor(a: vec4, b: vec4, t: number): vec4 {
    return new vec4(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t,
      a.a + (b.a - a.a) * t
    )
  }

  private setOnBoth(prop: string, value: any) {
    if (this.leftMat) this.leftMat.mainPass[prop] = value
    if (this.rightMat) this.rightMat.mainPass[prop] = value
  }
}
