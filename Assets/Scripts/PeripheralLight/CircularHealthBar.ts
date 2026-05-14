import {PlayerHealthManager} from "./PlayerHealthManager"

const LOG_TAG = "[CircularHealthBar]"

@component
export class CircularHealthBar extends BaseScriptComponent {
  @input
  @hint("RenderMeshVisual on the overlay Plane (must use a Graph Material with a fillAmount float parameter)")
  @allowUndefined
  damageOverlay: RenderMeshVisual

  @input
  @hint("Text component for debug health % display (placed on top of the colour wheel)")
  @allowUndefined
  debugScoreText: Text

  @input
  @hint("Name of the float parameter on the Graph Material that controls radial fill (0=no damage, 1=full black)")
  fillPropertyName: string = "fillAmount"

  private overlayMat: Material
  private healthManager: PlayerHealthManager

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    if (this.damageOverlay) {
      this.overlayMat = this.damageOverlay.mainMaterial.clone()
      this.damageOverlay.mainMaterial = this.overlayMat
      this.overlayMat.mainPass[this.fillPropertyName] = 0.0
      print(`${LOG_TAG} Overlay material cloned, fillPropertyName="${this.fillPropertyName}"`)
    } else {
      print(`${LOG_TAG} WARNING: damageOverlay not wired`)
    }

    this.healthManager = PlayerHealthManager.getInstance() as PlayerHealthManager
    if (this.healthManager) {
      this.healthManager.onHealthChanged.add((healthPercent: number) => {
        this.updateVisuals(healthPercent)
      })
      this.updateVisuals(this.healthManager.getHealthPercent())
      print(`${LOG_TAG} Subscribed to PlayerHealthManager events via singleton`)
    } else {
      print(`${LOG_TAG} WARNING: PlayerHealthManager singleton not found yet, retrying on update`)
      this.createEvent("UpdateEvent").bind(() => this.tryLateBinding())
    }
  }

  private tryLateBinding() {
    if (this.healthManager) return

    this.healthManager = PlayerHealthManager.getInstance() as PlayerHealthManager
    if (this.healthManager) {
      this.healthManager.onHealthChanged.add((healthPercent: number) => {
        this.updateVisuals(healthPercent)
      })
      this.updateVisuals(this.healthManager.getHealthPercent())
      print(`${LOG_TAG} Late-bound to PlayerHealthManager singleton`)
    }
  }

  private updateVisuals(healthPercent: number) {
    const fillAmount = 1.0 - (healthPercent / 100)

    if (this.overlayMat) {
      this.overlayMat.mainPass[this.fillPropertyName] = fillAmount
    }

    if (this.debugScoreText) {
      this.debugScoreText.text = `Your Glow: ${Math.round(healthPercent)}%`
    }
  }
}
