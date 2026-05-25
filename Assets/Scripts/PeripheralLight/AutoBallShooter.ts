import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {CancelToken, clearTimeout, setTimeout} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils"
import {GameLogicManager} from "Scripts/GameLogicManager"
import {AutoColorCycler} from "./AutoColorCycler"
import {BallCometTrailController} from "./BallCometTrailController"
import {HandVFXController} from "./HandVFXController"
import {LightHandEventListener} from "./LightHandEventListener"
import {PlayerHealthManager} from "./PlayerHealthManager"

const LOG_TAG = "[AutoBallShooter]"

interface FlyingBall {
  obj: SceneObject
  startPos: vec3
  endPos: vec3
  startTime: number
  duration: number
  arcHeight: number
  hit: boolean
}

@component
export class AutoBallShooter extends BaseScriptComponent {
  @input
  autoColorCycler: AutoColorCycler

  @input
  lightHandEventListener: LightHandEventListener

  @input
  mainCam: SceneObject

  @input
  ballPrefab: ObjectPrefab

  @input
  @hint("Seconds to wait after color change before launching the ball")
  delayThrowTime: number = 0.3

  @input
  @hint("Minimum peak height (cm) of the arc above the straight line")
  arcHeightMin: number = 15

  @input
  @hint("Maximum peak height (cm) of the arc above the straight line")
  arcHeightMax: number = 45

  @input
  @hint("Minimum seconds for the ball to fly from lamp to player")
  flightTimeMin: number = 1.0

  @input
  @hint("Maximum seconds for the ball to fly from lamp to player")
  flightTimeMax: number = 2.5

  @input
  @hint("Uniform scale of the spawned ball")
  ballScale: number = 5

  @input
  @hint("Oldest ball is destroyed when this cap is exceeded")
  maxActiveBalls: number = 5

  @input
  @hint("Master on/off toggle for ball shooting")
  shootingEnabled: boolean = true

  @input
  @allowUndefined
  @hint("Sound played when a ball hits the player. Wire an AudioComponent with your desired clip.")
  hitSound: AudioComponent

  @input
  @allowUndefined
  @hint("One-shot played the instant Lumia launches a lamp ball toward the player")
  launchSound: AudioComponent

  @input
  @allowUndefined
  @hint("ColliderComponent on the player (camera child). Ball must overlap this to count as a hit. If not wired, every ball is a guaranteed hit.")
  playerCollider: ColliderComponent

  @input
  @hint("How far past the player (as a multiplier of flightTime) the ball continues before being destroyed. E.g. 1.5 = ball flies 50% beyond the target.")
  overshootMultiplier: number = 1.5

  @ui.separator
  @ui.label("Hand Defence")

  @input
  @allowUndefined
  @hint("HandVFXController on this prefab, used to read the current hand contour color for the color-match defence gate")
  handVFXController: HandVFXController

  @input
  @allowUndefined
  @hint("Prefab spawned at the ball's position when a same-tone hand shatters it. Must contain a VFXComponent at the root (or first child) exposing particleColor and particleEmissionBoost properties.")
  shatterPrefab: ObjectPrefab

  @input
  @hint("Distance (cm) from a hand's index tip to the ball center that counts as a touch")
  touchRadius: number = 6.0

  @input
  @hint("Seconds the spawned shatter FX SceneObject lives before being destroyed")
  shatterLifetimeSeconds: number = 2.0

  @input
  @hint("Health % restored when the player's hand successfully shatters a same-tone lamp ball. Set to 0 to disable healing.")
  healPercentOnShatter: number = 5

  @input
  @hint("Emission multiplier pushed to the shatter VFX graph's particleEmissionBoost property")
  shatterEmissionBoost: number = 2

  @input
  @allowUndefined
  @hint("One-shot played when a same-tone hand shatters a lamp ball")
  shatterSound: AudioComponent

  // Fires the instant a lamp ball is actually launched (after delayThrowTime,
  // not when the cycler ticks). LampFaceAnimator hooks this to flash its attack
  // expression at the moment the ball leaves the lamp rather than during the
  // pre-attack charging window. Payload is the ball color (vec4) for parity with
  // onColorCycled in case future listeners want to color-match.
  private _onBallSpawned: Event<vec4> = new Event<vec4>()
  get onBallSpawned() { return this._onBallSpawned.publicApi() }

  // Singleton registration so listeners inside runtime-instantiated prefabs
  // (e.g. LampFaceAnimator in LampOnboarding.prefab) can resolve us via
  // getInstance() instead of an @input. Cross-prefab @input ScriptComponent
  // references in Lens Studio sometimes resolve to a remapped view that doesn't
  // share the same in-memory Event subscriber list, so handlers added through
  // an @input never fire when invoke() runs on the real instance. Going
  // through the singleton avoids that pitfall and matches the pattern already
  // used by LampHealthManager / PlayerHealthManager / AutoColorCycler.
  private static instance: AutoBallShooter

  static getInstance(): AutoBallShooter | undefined {
    return AutoBallShooter.instance
  }

  private flyingBalls: FlyingBall[] = []
  private pendingThrowToken: CancelToken = null
  private mainCamTrans: Transform
  private leftHand: TrackedHand = null
  private rightHand: TrackedHand = null

  onAwake() {
    if (AutoBallShooter.instance) {
      print(`${LOG_TAG} WARNING: Multiple instances detected, only one AutoBallShooter should exist in the scene`)
    }
    AutoBallShooter.instance = this

    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    this.mainCamTrans = this.mainCam.getTransform()

    if (!this.autoColorCycler) {
      print(`${LOG_TAG} WARNING: autoColorCycler not wired in Inspector`)
      return
    }

    this.autoColorCycler.onColorCycled.add((color: vec4) => {
      this.onColorCycled(color)
    })

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())

    if (this.playerCollider) {
      this.playerCollider.onOverlapEnter.add((args: OverlapEnterEventArgs) => {
        this.onPlayerOverlap(args)
      })
      print(`${LOG_TAG} Player collider wired, dodge mode enabled`)
    } else {
      print(`${LOG_TAG} No player collider wired, every ball is a guaranteed hit`)
    }

    try {
      const handInputData = SIK.HandInputData
      this.leftHand = handInputData.getHand("left")
      this.rightHand = handInputData.getHand("right")
      print(`${LOG_TAG} Hand defence wired, touchRadius=${this.touchRadius}cm, healPercentOnShatter=${this.healPercentOnShatter}%`)
    } catch (e) {
      print(`${LOG_TAG} WARNING: Could not resolve hand tracking, hand defence disabled (${e})`)
    }

    print(`${LOG_TAG} Initialized. delayThrowTime=${this.delayThrowTime}s, flightTime=[${this.flightTimeMin}-${this.flightTimeMax}]s, arcHeight=[${this.arcHeightMin}-${this.arcHeightMax}]`)
  }

  private onColorCycled(color: vec4) {
    if (!this.shootingEnabled) return

    const spawnPos = this.lightHandEventListener.surfaceDetectionPosition
    if (spawnPos === undefined) {
      print(`${LOG_TAG} Light not placed yet, skipping ball`)
      return
    }

    if (this.pendingThrowToken) {
      clearTimeout(this.pendingThrowToken)
    }

    // SIK's setTimeout takes milliseconds (it divides by 1000 internally
     // before handing off to createDelayedEvent, which is seconds-based).
     // delayThrowTime is authored in seconds in the inspector, so convert.
    this.pendingThrowToken = setTimeout(() => {
      this.pendingThrowToken = null
      this.spawnBall(color, spawnPos)
    }, this.delayThrowTime * 1000)
  }

  private spawnBall(color: vec4, startPos: vec3) {
    if (!this.ballPrefab) {
      print(`${LOG_TAG} WARNING: ballPrefab not assigned`)
      return
    }

    const ball = this.ballPrefab.instantiate(null)
    ball.name = "LampBall"
    const tr = ball.getTransform()
    tr.setWorldPosition(startPos)
    tr.setLocalScale(vec3.one().uniformScale(this.ballScale))

    const body = ball.getComponent("Physics.BodyComponent") as BodyComponent
    if (body) {
      body.dynamic = false
    }

    const rmv = ball.getComponent("RenderMeshVisual") as RenderMeshVisual
    if (rmv) {
      const mat = rmv.mainMaterial.clone()
      rmv.mainMaterial = mat
      mat.mainPass.baseColor = new vec4(color.r, color.g, color.b, 1.0)
    }

    const trailCtrl = this.findTrailController(ball)
    if (trailCtrl) {
      trailCtrl.startTrail(new vec4(color.r, color.g, color.b, 1.0))
    }

    const endPos = this.mainCamTrans.getWorldPosition()
    const duration = Math.max(0.1, this.randomRange(this.flightTimeMin, this.flightTimeMax))
    const arcHeight = this.randomRange(this.arcHeightMin, this.arcHeightMax)

    this.flyingBalls.push({
      obj: ball,
      startPos: startPos,
      endPos: endPos,
      startTime: getTime(),
      duration: duration,
      arcHeight: arcHeight,
      hit: false
    })

    print(`${LOG_TAG} Ball launched toward player, duration=${duration.toFixed(2)}s, arcHeight=${arcHeight.toFixed(1)}`)

    while (this.flyingBalls.length > this.maxActiveBalls) {
      const oldest = this.flyingBalls.shift()
      if (oldest) {
        oldest.obj.destroy()
      }
    }

    if (this.launchSound) this.launchSound.play(1)

    this._onBallSpawned.invoke(color)
  }

  private onUpdate() {
    const now = getTime()
    const maxS = this.playerCollider ? this.overshootMultiplier : 1.0
    let i = 0

    while (i < this.flyingBalls.length) {
      const fb = this.flyingBalls[i]
      const elapsed = now - fb.startTime
      const s = elapsed / fb.duration

      if (s >= maxS) {
        if (!this.playerCollider && !fb.hit) {
          this.onBallHitPlayer(fb.obj)
        }
        fb.obj.destroy()
        this.flyingBalls.splice(i, 1)
        continue
      }

      const pos = this.evaluateParabola(fb.startPos, fb.endPos, fb.arcHeight, s)
      fb.obj.getTransform().setWorldPosition(pos)
      i++
    }

    this.checkHandShatter()
  }

  /**
   * Hand defence: per-frame, for each in-flight LampBall, check if any tracked hand's
   * index tip is within `touchRadius` AND the hand's current contour color matches the
   * ball's color (per GameLogicManager.areColorsSimilar). On a match: spawn the shatter
   * FX at the ball, destroy the ball, and heal the player by `healPercentOnShatter`.
   * A mismatched-color hand passes through harmlessly — the ball keeps flying.
   */
  private checkHandShatter() {
    if (!this.handVFXController || !this.shatterPrefab) return

    const handColor = this.handVFXController.getCurrentContourColor()
    if (!handColor) return

    const mgr = GameLogicManager.getInstance()
    if (!mgr) return

    const hands: TrackedHand[] = []
    if (this.leftHand && this.leftHand.isTracked()) hands.push(this.leftHand)
    if (this.rightHand && this.rightHand.isTracked()) hands.push(this.rightHand)
    if (hands.length === 0) return

    for (let j = this.flyingBalls.length - 1; j >= 0; j--) {
      const fb = this.flyingBalls[j]
      if (fb.hit) continue

      const ballColor = GameLogicManager.getObjectColor(fb.obj)
      if (!ballColor) continue
      if (!mgr.areColorsSimilar(handColor, ballColor)) continue

      const ballPos = fb.obj.getTransform().getWorldPosition()
      for (let h = 0; h < hands.length; h++) {
        const dist = hands[h].indexTip.position.distance(ballPos)
        if (dist > this.touchRadius) continue

        fb.hit = true
        this.fireShatter(ballPos, ballColor)
        fb.obj.destroy()
        this.flyingBalls.splice(j, 1)

        if (this.healPercentOnShatter > 0) {
          const health = PlayerHealthManager.getInstance()
          if (health) health.heal(this.healPercentOnShatter)
        }

        print(`${LOG_TAG} Lamp ball SHATTERED by hand (dist=${dist.toFixed(1)}cm), +${this.healPercentOnShatter}% health`)
        break
      }
    }
  }

  private fireShatter(pos: vec3, color: vec4) {
    if (!this.shatterPrefab) return

    if (this.shatterSound) this.shatterSound.play(1)

    const fx = this.shatterPrefab.instantiate(null)
    fx.getTransform().setWorldPosition(pos)

    const vfx = this.findVfxComponent(fx)
    if (vfx) {
      if (vfx.asset) {
        try {
          const props = vfx.asset.properties as any
          props["particleColor"] = color
          props["particleEmissionBoost"] = this.shatterEmissionBoost
        } catch (_) {
          // particleColor / particleEmissionBoost may not be exposed on the graph yet
        }
      }
      vfx.enabled = false
      vfx.enabled = true
    } else {
      print(`${LOG_TAG} WARNING: shatterPrefab has no VFXComponent`)
    }

    const cleanup = this.createEvent("DelayedCallbackEvent")
    cleanup.bind(() => {
      if (fx) fx.destroy()
    })
    cleanup.reset(this.shatterLifetimeSeconds)
  }

  private findVfxComponent(obj: SceneObject): VFXComponent | null {
    const direct = obj.getComponent("Component.VFXComponent") as VFXComponent
    if (direct) return direct
    const count = obj.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const found = this.findVfxComponent(obj.getChild(i))
      if (found) return found
    }
    return null
  }

  /**
   * Locate the BallCometTrailController on the lamp ball by duck-typing
   * on its `startTrail` method, so we don't depend on script ordering when
   * the prefab grows additional ScriptComponents.
   */
  private findTrailController(obj: SceneObject): BallCometTrailController | null {
    const scripts = obj.getComponents("Component.ScriptComponent")
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i] as any
      if (s && typeof s.startTrail === "function") {
        return s as BallCometTrailController
      }
    }
    return null
  }

  private onPlayerOverlap(args: OverlapEnterEventArgs) {
    const otherName = args.overlap.collider.getSceneObject().name
    if (otherName !== "LampBall") return

    const ballObj = args.overlap.collider.getSceneObject()
    for (let i = 0; i < this.flyingBalls.length; i++) {
      if (this.flyingBalls[i].obj === ballObj && !this.flyingBalls[i].hit) {
        this.flyingBalls[i].hit = true
        this.onBallHitPlayer(ballObj)
        ballObj.destroy()
        this.flyingBalls.splice(i, 1)
        print(`${LOG_TAG} Player HIT by lamp ball!`)
        return
      }
    }
  }

  private onBallHitPlayer(ballObj?: SceneObject) {
    if (this.hitSound) {
      this.hitSound.play(1)
    }
    const health = PlayerHealthManager.getInstance()
    if (!health) return

    const color = ballObj ? GameLogicManager.getObjectColor(ballObj) : null
    health.takeDamage(undefined, color || undefined)
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }

  private evaluateParabola(start: vec3, end: vec3, arcHeight: number, s: number): vec3 {
    const linear = vec3.lerp(start, end, s)
    const arcOffset = arcHeight * 4.0 * s * (1.0 - s)
    return new vec3(linear.x, linear.y + arcOffset, linear.z)
  }
}
