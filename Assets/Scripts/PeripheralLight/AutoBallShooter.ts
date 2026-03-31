import {CancelToken, clearTimeout, setTimeout} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils"
import {AutoColorCycler} from "./AutoColorCycler"
import {LightHandEventListener} from "./LightHandEventListener"

const LOG_TAG = "[AutoBallShooter]"

interface FlyingBall {
  obj: SceneObject
  startPos: vec3
  endPos: vec3
  startTime: number
  duration: number
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
  @hint("Peak height (cm) of the arc above the straight line between lamp and player")
  arcHeight: number = 30

  @input
  @hint("Seconds for the ball to fly from lamp to player; longer = slower, gentler arc")
  flightTime: number = 1.5

  @input
  @hint("Scales flight speed; >1 = faster, <1 = slower")
  speedMultiplier: number = 1.0

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
  @hint("ColliderComponent on the player (camera child). Ball must overlap this to count as a hit. If not wired, every ball is a guaranteed hit.")
  playerCollider: ColliderComponent

  @input
  @hint("How far past the player (as a multiplier of flightTime) the ball continues before being destroyed. E.g. 1.5 = ball flies 50% beyond the target.")
  overshootMultiplier: number = 1.5

  private flyingBalls: FlyingBall[] = []
  private pendingThrowToken: CancelToken = null
  private mainCamTrans: Transform

  onAwake() {
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

    print(`${LOG_TAG} Initialized. delayThrowTime=${this.delayThrowTime}s, flightTime=${this.flightTime}s, arcHeight=${this.arcHeight}`)
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

    this.pendingThrowToken = setTimeout(() => {
      this.pendingThrowToken = null
      this.spawnBall(color, spawnPos)
    }, this.delayThrowTime)
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

    const endPos = this.mainCamTrans.getWorldPosition()
    const duration = Math.max(0.1, this.flightTime / Math.max(0.01, this.speedMultiplier))

    this.flyingBalls.push({
      obj: ball,
      startPos: startPos,
      endPos: endPos,
      startTime: getTime(),
      duration: duration,
      hit: false
    })

    print(`${LOG_TAG} Ball launched toward player, duration=${duration.toFixed(2)}s, arcHeight=${this.arcHeight}`)

    while (this.flyingBalls.length > this.maxActiveBalls) {
      const oldest = this.flyingBalls.shift()
      if (oldest) {
        oldest.obj.destroy()
      }
    }
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
          this.onBallHitPlayer()
        }
        fb.obj.destroy()
        this.flyingBalls.splice(i, 1)
        continue
      }

      const pos = this.evaluateParabola(fb.startPos, fb.endPos, s)
      fb.obj.getTransform().setWorldPosition(pos)
      i++
    }
  }

  private onPlayerOverlap(args: OverlapEnterEventArgs) {
    const otherName = args.overlap.collider.getSceneObject().name
    if (otherName !== "LampBall") return

    const ballObj = args.overlap.collider.getSceneObject()
    for (let i = 0; i < this.flyingBalls.length; i++) {
      if (this.flyingBalls[i].obj === ballObj && !this.flyingBalls[i].hit) {
        this.flyingBalls[i].hit = true
        this.onBallHitPlayer()
        ballObj.destroy()
        this.flyingBalls.splice(i, 1)
        print(`${LOG_TAG} Player HIT by lamp ball!`)
        return
      }
    }
  }

  private onBallHitPlayer() {
    if (this.hitSound) {
      this.hitSound.play(1)
    }
  }

  private evaluateParabola(start: vec3, end: vec3, s: number): vec3 {
    const linear = vec3.lerp(start, end, s)
    const arcOffset = this.arcHeight * 4.0 * s * (1.0 - s)
    return new vec3(linear.x, linear.y + arcOffset, linear.z)
  }
}
