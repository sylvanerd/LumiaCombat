import LineRenderer from "SpectaclesInteractionKit.lspkg/Utils/views/LineRenderer/LineRenderer"

const TRAIL_LOG = "[BallCometTrail]"

/**
 * Draws a thick, solid-color comet ribbon trailing behind a moving ball.
 *
 * Uses SpectaclesInteractionKit's LineRenderer (a MeshBuilder-backed line strip)
 * to render a continuous quad-strip — not loose particles — so the trail reads
 * as a single chunk of color following the ball, like a comet's tail.
 *
 * Attach to the FingerBall or LampBall prefab root. Each ball type can tune
 * `tailPointCount` differently to vary the visible tail length.
 *
 * Lifecycle:
 *   1. Idle       — startTrail() has not been called yet
 *   2. Trailing   — UpdateEvent samples the ball's world position each frame
 *                   into a ring buffer; the LineRenderer points = ring buffer
 *   3. Stopped    — LineRenderer destroyed, update unbinds
 */
@component
export class BallCometTrailController extends BaseScriptComponent {
  @input
  @hint("MUST be a LineRenderer-compatible material — i.e. one whose shader exposes startColor / endColor / startWidth / endWidth / billboarding uniforms. The simplest path is to duplicate Packages/SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorCursor/ManipulateLineMaterial.mat (or InteractorLineMaterial.mat) into your Assets and assign that. A generic 'unlit' material WILL render zero-width and look invisible.")
  lineMaterial: Material

  @input
  @hint("Ring buffer size — number of recent positions kept in the trail. Higher = longer visible tail. FingerBall ~30, LampBall ~8.")
  tailPointCount: number = 20

  @input
  @hint("Trail width (cm) at the head, near the ball. Set close to the ball's diameter for the chunky comet look.")
  startWidth: number = 4.0

  @input
  @hint("Trail width (cm) at the tail tip. 0 for a sharp taper, startWidth*0.3 for a stubbier feel.")
  endWidth: number = 0.0

  @input
  @hint("Only push a new point when the ball has moved at least this many cm since the last sample. Prevents zero-length segments when the ball is stationary.")
  minSampleDistance: number = 1.0

  @input
  @hint("HDR multiplier applied to the ball's base color so the trail reads bright/emissive.")
  emissionBoost: number = 2.0

  @input
  @hint("Hard timeout (s) after which the trail self-destructs even if stopTrail() is never called.")
  autoStopAfter: number = 5.0

  @input
  @allowUndefined
  @hint("Optional stable parent SceneObject the trail's LineRenderer attaches to. If unset, a fresh empty SceneObject is created at scene root (recommended). NEVER set this to the moving ball or to the Camera Object.")
  trailParent: SceneObject

  private line: LineRenderer | null = null
  private holderObj: SceneObject | null = null
  private ring: vec3[] = []
  private active: boolean = false
  private elapsed: number = 0
  private lastSampled: vec3 | null = null
  private updateBound: boolean = false

  /**
   * Begin trailing. Call after the ball has been thrown / launched.
   * @param ballColor base color of the ball; used (boosted by emissionBoost) as the trail color.
   */
  startTrail(ballColor: vec4) {
    if (this.active) {
      this.stopTrail()
    }

    if (!this.lineMaterial) {
      print(`${TRAIL_LOG} ERROR: No lineMaterial assigned in Inspector — skipping trail`)
      return
    }

    const parent = this.resolveTrailParent()
    if (!parent) {
      print(`${TRAIL_LOG} ERROR: No valid trailParent and no root scene objects — skipping trail`)
      return
    }

    const tintedColor = this.boostColor(ballColor)

    const startPos = this.sceneObject.getTransform().getWorldPosition()
    this.ring = [startPos, startPos]

    // LineRenderer.config.material is internally cloned by the LineRenderer
    // (see SIK source — `protected material = this.config.material.clone()`),
    // so multiple balls referencing the same Inspector material asset already
    // get isolated per-instance copies. No need to clone here.
    // The LineRenderer-compatible shader uses startColor / endColor uniforms,
    // not mainPass.baseColor, so we tint via those.
    this.line = new LineRenderer({
      material: this.lineMaterial,
      points: this.ring,
      startWidth: this.startWidth,
      endWidth: this.endWidth,
      startColor: tintedColor,
      endColor: tintedColor,
      lookAtCamera: true,
      name: "BallCometTrail"
    })
    this.line.attachToScene(parent)
    this.refreshLinePoints()

    this.lastSampled = startPos
    this.elapsed = 0
    this.active = true

    if (!this.updateBound) {
      this.createEvent("UpdateEvent").bind(() => this.tick())
      this.updateBound = true
    }

    print(`${TRAIL_LOG} Trail started — color=(${tintedColor.r.toFixed(2)},${tintedColor.g.toFixed(2)},${tintedColor.b.toFixed(2)}), startWidth=${this.startWidth}, parent=${parent.name}, ballPos=(${startPos.x.toFixed(1)},${startPos.y.toFixed(1)},${startPos.z.toFixed(1)})`)
  }

  /**
   * Stop and destroy the trail. Safe to call even if not active.
   * Also called automatically when the host SceneObject is destroyed
   * (via the bound DestroyEvent below) so flying balls clean up correctly.
   */
  stopTrail() {
    if (!this.active && !this.line && !this.holderObj) return
    this.active = false

    if (this.line) {
      try {
        this.line.destroy()
      } catch (_) {
        // already destroyed
      }
      this.line = null
    }

    if (this.holderObj) {
      try {
        this.holderObj.destroy()
      } catch (_) {
        // already destroyed
      }
      this.holderObj = null
    }

    this.ring = []
    this.lastSampled = null
    print(`${TRAIL_LOG} Trail stopped`)
  }

  onAwake() {
    this.createEvent("OnDestroyEvent").bind(() => this.stopTrail())
  }

  private tick() {
    if (!this.active || !this.line) return

    this.elapsed += getDeltaTime()
    if (this.elapsed >= this.autoStopAfter) {
      this.stopTrail()
      return
    }

    const p = this.sceneObject.getTransform().getWorldPosition()
    if (this.lastSampled && p.distance(this.lastSampled) < this.minSampleDistance) {
      this.refreshLinePoints()
      return
    }

    this.ring.push(p)
    if (this.ring.length > this.tailPointCount) {
      this.ring.shift()
    }
    this.lastSampled = p
    this.refreshLinePoints()
  }

  /**
   * Push the world-space ring buffer into the LineRenderer, converting each
   * point to the LineRenderer's local space every frame so a non-identity or
   * moving parent transform (e.g. Camera Object) is corrected for. Without
   * this, the trail visually drifts with whatever scene object we ended up
   * parented to.
   */
  private refreshLinePoints() {
    if (!this.line) return
    const localPoints: vec3[] = []
    for (let i = 0; i < this.ring.length; i++) {
      localPoints.push(this.line.getRelativePosOfPoint(this.ring[i]))
    }
    this.line.points = localPoints
  }

  /**
   * Pick a stable parent SceneObject for the trail's LineRenderer. If the user
   * wired one in the Inspector, use it. Otherwise create a fresh empty
   * SceneObject at scene root — that guarantees a non-moving, world-identity
   * parent (the previous "first root scene object" approach picked up the
   * Camera Object, which moves with the user's head and dragged the trail
   * along with it, making it invisible at the expected world position).
   */
  private resolveTrailParent(): SceneObject | null {
    if (this.trailParent) return this.trailParent
    this.holderObj = global.scene.createSceneObject("BallCometTrail_Holder")
    return this.holderObj
  }

  private boostColor(c: vec4): vec4 {
    return new vec4(
      Math.min(1, c.r * this.emissionBoost),
      Math.min(1, c.g * this.emissionBoost),
      Math.min(1, c.b * this.emissionBoost),
      1.0
    )
  }
}
