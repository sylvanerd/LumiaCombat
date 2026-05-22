import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

const LOG_TAG = "[PlayerHealthManager]"

@component
export class PlayerHealthManager extends BaseScriptComponent {
  @input
  @hint("Total health points")
  maxHealth: number = 100

  @input
  @hint("Percentage of maxHealth lost per lamp ball hit")
  damagePerHit: number = 10

  @input
  @hint("Seconds of invincibility after taking a hit (prevents rapid multi-hits)")
  invincibilityDuration: number = 0.5

  @input
  @hint("Health % restored when a lamp ball is neutralized by colour-matching")
  healPerNeutralize: number = 5

  @input
  @hint("Health % threshold for low-health state (exposed for future warning hooks)")
  lowHealthThreshold: number = 25

  private static instance: PlayerHealthManager

  private currentHealth: number = 100
  private alive: boolean = true
  private lastHitTime: number = -999

  private _onHealthChanged: Event<number> = new Event<number>()
  get onHealthChanged() { return this._onHealthChanged.publicApi() }

  private _onPlayerDied: Event<void> = new Event<void>()
  get onPlayerDied() { return this._onPlayerDied.publicApi() }

  // Fires only when a damage hit actually lands (i.e. NOT blocked by invincibility),
  // so visual feedback (DamageFlashOverlay) stays in sync with the health drop.
  // Payload is the color of the source (e.g. the lamp ball's baseColor) so listeners
  // can tint themselves to match what hit the player.
  private _onDamageFlash: Event<vec4> = new Event<vec4>()
  get onDamageFlash() { return this._onDamageFlash.publicApi() }

  static getInstance(): PlayerHealthManager | undefined {
    return PlayerHealthManager.instance
  }

  onAwake() {
    if (PlayerHealthManager.instance) {
      print(`${LOG_TAG} WARNING: Multiple instances detected`)
    }
    PlayerHealthManager.instance = this
    this.currentHealth = this.maxHealth

    print(`${LOG_TAG} Singleton initialized, maxHealth=${this.maxHealth}, damagePerHit=${this.damagePerHit}%, healPerNeutralize=${this.healPerNeutralize}%`)
  }

  getHealthPercent(): number {
    return (this.currentHealth / this.maxHealth) * 100
  }

  isAlive(): boolean {
    return this.alive
  }

  takeDamage(percent?: number, color?: vec4) {
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

    if (color) {
      this._onDamageFlash.invoke(color)
    }

    if (this.currentHealth <= 0) {
      this.alive = false
      print(`${LOG_TAG} Player died!`)
      this._onPlayerDied.invoke()
    }
  }

  heal(percent: number) {
    if (!this.alive || percent <= 0) return

    const healAmount = (percent / 100) * this.maxHealth
    const prevHealth = this.currentHealth
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + healAmount)

    if (this.currentHealth !== prevHealth) {
      const healthPct = this.getHealthPercent()
      print(`${LOG_TAG} Healed ${percent}%, health=${healthPct.toFixed(1)}%`)
      this._onHealthChanged.invoke(healthPct)
    }
  }

  reset() {
    this.currentHealth = this.maxHealth
    this.alive = true
    this.lastHitTime = -999
    print(`${LOG_TAG} Health reset to ${this.maxHealth}`)
    this._onHealthChanged.invoke(100)
  }
}
