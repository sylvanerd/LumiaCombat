import {CancelToken, clearTimeout, setTimeout} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils"
import {GameLogicManager} from "Scripts/GameLogicManager"
import {AutoColorCycler} from "./AutoColorCycler"
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

    const ballCollider = ball.getComponent("Physics.ColliderComponent") as ColliderComponent
    if (ballCollider) {
      ballCollider.onOverlapEnter.add((args: OverlapEnterEventArgs) => {
        this.onLampBallOverlap(ball, args)
      })
    }

    print(`${LOG_TAG} Ball launched toward player, duration=${duration.toFixed(2)}s, arcHeight=${arcHeight.toFixed(1)}`)

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

      const pos = this.evaluateParabola(fb.startPos, fb.endPos, fb.arcHeight, s)
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

  private onLampBallOverlap(lampBallObj: SceneObject, args: OverlapEnterEventArgs) {
    const fingerBallObj = args.overlap.collider.getSceneObject()
    if (fingerBallObj.name !== "Sphere") return

    const manager = GameLogicManager.getInstance()
    if (!manager) return

    const fingerBallColor = GameLogicManager.getObjectColor(fingerBallObj)
    const lampBallColor = GameLogicManager.getObjectColor(lampBallObj)
    if (!fingerBallColor || !lampBallColor) return

    const hueDist = manager.getHueDistance(fingerBallColor, lampBallColor)

    if (manager.areColorsSimilar(fingerBallColor, lampBallColor)) {
      for (let i = 0; i < this.flyingBalls.length; i++) {
        if (this.flyingBalls[i].obj === lampBallObj && !this.flyingBalls[i].hit) {
          this.flyingBalls[i].hit = true
          lampBallObj.destroy()
          this.flyingBalls.splice(i, 1)
          const health = PlayerHealthManager.getInstance()
          if (health) {
            health.heal(health.healPerNeutralize)
          }
          print(`${LOG_TAG} Lamp ball NEUTRALIZED by finger ball (similar color, hueDist=${hueDist.toFixed(3)})`)
          return
        }
      }
    } else {
      print(`${LOG_TAG} Finger ball touched lamp ball but colors not similar (hueDist=${hueDist.toFixed(3)}), ball continues`)
    }
  }

  private onBallHitPlayer() {
    if (this.hitSound) {
      this.hitSound.play(1)
    }
    const health = PlayerHealthManager.getInstance()
    if (health) {
      health.takeDamage()
    }
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
