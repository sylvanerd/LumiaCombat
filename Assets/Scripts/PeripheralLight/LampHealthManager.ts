import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {GameLogicManager} from "Scripts/GameLogicManager"
import {LampColliderSpawner} from "./LampColliderSpawner"
import {HueEventEmitter} from "./HueEventEmitter"
import {AutoColorCycler} from "./AutoColorCycler"

const LOG_TAG = "[LampHealthManager]"

@component
export class LampHealthManager extends BaseScriptComponent {
  @input
  @hint("The LampColliderSpawner on this prefab, source of raw collision events")
  colliderSpawner: LampColliderSpawner

  @input
  @hint("HueEventEmitter on this prefab, used to turn the light off on defeat")
  hueEventEmitter: HueEventEmitter

  @input
  @hint("AutoColorCycler on this prefab, stopped on defeat")
  autoColorCycler: AutoColorCycler

  @input
  @hint("Total health points")
  maxHealth: number = 100

  @input
  @hint("Percentage of maxHealth lost per finger ball hit")
  damagePerHit: number = 10

  @input
  @hint("Seconds of invincibility after taking a hit (prevents rapid multi-hits)")
  invincibilityDuration: number = 0.5

  @input
  @hint("Health % threshold for low-health state (exposed for future warning hooks)")
  lowHealthThreshold: number = 25

  @input
  @allowUndefined
  @hint("Sound effect played when the finger ball hits the lamp")
  hitSound: AudioComponent

  @input
  @allowUndefined
  @hint("Text component for 'You Win' message (initially disabled)")
  winText: Text

  private static instance: LampHealthManager

  private currentHealth: number = 100
  private alive: boolean = true
  private lastHitTime: number = -999

  private _onHealthChanged: Event<number> = new Event<number>()
  get onHealthChanged() { return this._onHealthChanged.publicApi() }

  private _onLampDied: Event<void> = new Event<void>()
  get onLampDied() { return this._onLampDied.publicApi() }

  static getInstance(): LampHealthManager | undefined {
    return LampHealthManager.instance
  }

  onAwake() {
    if (LampHealthManager.instance) {
      print(`${LOG_TAG} WARNING: Multiple instances detected`)
    }
    LampHealthManager.instance = this

    this.currentHealth = this.maxHealth

    if (this.winText) {
      this.winText.getSceneObject().enabled = false
    }

    this.colliderSpawner.onBallCollision.add((collider: ColliderComponent) => {
      this.handleHit(collider)
    })

    print(`${LOG_TAG} Singleton initialized, maxHealth=${this.maxHealth}, damagePerHit=${this.damagePerHit}%`)
  }

  getHealthPercent(): number {
    return (this.currentHealth / this.maxHealth) * 100
  }

  isAlive(): boolean {
    return this.alive
  }

  private handleHit(collider: ColliderComponent) {
    if (!this.alive) return

    const fingerBallObj = collider.getSceneObject()
    const manager = GameLogicManager.getInstance()
    const fingerBallColor = GameLogicManager.getObjectColor(fingerBallObj)

    if (manager && fingerBallColor) {
      const lampColor = manager.getCurrentLampColor()
      const hueDist = manager.getHueDistance(fingerBallColor, lampColor)

      if (!manager.areColorsContrasting(fingerBallColor, lampColor)) {
        print(`${LOG_TAG} Finger ball color NOT contrasting with lamp (hueDist=${hueDist.toFixed(3)}), ignoring hit`)
        return
      }
      print(`${LOG_TAG} Finger ball color IS contrasting (hueDist=${hueDist.toFixed(3)}), applying damage`)
    }

    if (this.hitSound) {
      this.hitSound.play(1)
    }

    this.takeDamage()
  }

  takeDamage(percent?: number) {
    if (!this.alive) return

    const now = getTime()
    if (now - this.lastHitTime < this.invincibilityDuration) {
      print(`${LOG_TAG} Damage blocked by invincibility (${(this.invincibilityDuration - (now - this.lastHitTime)).toFixed(2)}s remaining)`)
      return
    }

    this.lastHitTime = now
    const dmgPercent = percent !== undefined ? percent : this.damagePerHit
    const dmgAmount = (dmgPercent / 100) * this.maxHealth
    this.currentHealth = Math.max(0, this.currentHealth - dmgAmount)

    const healthPct = this.getHealthPercent()
    print(`${LOG_TAG} Took ${dmgPercent}% damage, health=${healthPct.toFixed(1)}%`)
    this._onHealthChanged.invoke(healthPct)

    if (this.currentHealth <= 0) {
      this.die()
    }
  }

  private die() {
    this.alive = false
    print(`${LOG_TAG} Lamp defeated!`)

    this.hueEventEmitter.togglePower(false)
    this.autoColorCycler.stopCycling()

    if (this.winText) {
      this.winText.getSceneObject().enabled = true
      this.winText.text = "You Win"
    }

    this._onLampDied.invoke()
  }

  reset() {
    this.currentHealth = this.maxHealth
    this.alive = true
    this.lastHitTime = -999

    if (this.winText) {
      this.winText.getSceneObject().enabled = false
    }

    print(`${LOG_TAG} Health reset to ${this.maxHealth}`)
    this._onHealthChanged.invoke(100)
  }
}
