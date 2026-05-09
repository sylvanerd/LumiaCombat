import {GameLogicManager} from "Scripts/GameLogicManager"
import {LampHealthManager} from "./LampHealthManager"
import {LightHandEventListener} from "./LightHandEventListener"

const LOG_TAG = "[LampCircularHealthBar]"

@component
export class LampCircularHealthBar extends BaseScriptComponent {
  @input
  @hint("The LampHealthManager driving this health bar")
  lampHealthManager: LampHealthManager

  @input
  @hint("LightHandEventListener on the lamp prefab, used to read the placement position when the game starts")
  lightHandEventListener: LightHandEventListener

  @input
  @hint("Prefab containing the health UI (colour wheel + damage overlay). Instantiated at anchor position when the game starts.")
  healthUIPrefab: ObjectPrefab

  @input
  @hint("Y offset above the anchor position to spawn the health UI")
  yOffset: number = 30

  @input
  @hint("Name of the RenderMeshVisual child inside the prefab used as damage overlay")
  overlayChildName: string = "DamageOverlay"

  @input
  @hint("Name of the float parameter on the Graph Material that controls radial fill (0=no damage, 1=full black)")
  fillPropertyName: string = "fillAmount"

  private overlayMat: Material
  private placed: boolean = false
  private healthUIInstance: SceneObject

  onAwake() {
    // GameLogicManager.instance is set in its own onAwake; defer subscription to OnStartEvent
    // so we don't rely on script ordering.
    this.createEvent("OnStartEvent").bind(() => this.subscribeToGameStart())
  }

  private subscribeToGameStart() {
    const manager = GameLogicManager.getInstance()
    if (!manager) {
      print(`${LOG_TAG} WARNING: GameLogicManager not found in scene; health UI will never spawn`)
      return
    }
    manager.onGameStarted.add(() => this.onGameStarted())
    print(`${LOG_TAG} Subscribed to GameLogicManager.onGameStarted`)
  }

  private onGameStarted() {
    if (this.placed) return

    const pos = this.lightHandEventListener.surfaceDetectionPosition
    if (pos === undefined) {
      print(`${LOG_TAG} WARNING: onGameStarted fired but surfaceDetectionPosition is undefined; skipping health UI spawn`)
      return
    }

    this.placed = true
    this.spawnHealthUI(pos)
  }

  private spawnHealthUI(pos: vec3) {
    const spawnPos = new vec3(pos.x, pos.y + this.yOffset, pos.z)
    print(`${LOG_TAG} Spawning health UI at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)})`)

    this.healthUIInstance = this.healthUIPrefab.instantiate(null)
    this.healthUIInstance.getTransform().setWorldPosition(spawnPos)

    const overlay = this.findRenderMeshByName(this.healthUIInstance, this.overlayChildName)
    if (overlay) {
      this.overlayMat = overlay.mainMaterial.clone()
      overlay.mainMaterial = this.overlayMat
      this.overlayMat.mainPass[this.fillPropertyName] = 0.0
      print(`${LOG_TAG} Overlay material cloned, fillPropertyName="${this.fillPropertyName}"`)
    } else {
      print(`${LOG_TAG} WARNING: Could not find RenderMeshVisual named "${this.overlayChildName}" in health UI prefab`)
    }

    this.subscribeToHealth()
  }

  private findRenderMeshByName(obj: SceneObject, name: string): RenderMeshVisual | null {
    if (obj.name === name) {
      const rmv = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (rmv) return rmv
    }

    for (let i = 0; i < obj.getChildrenCount(); i++) {
      const found = this.findRenderMeshByName(obj.getChild(i), name)
      if (found) return found
    }
    return null
  }

  private subscribeToHealth() {
    if (this.lampHealthManager) {
      this.lampHealthManager.onHealthChanged.add((healthPercent: number) => {
        this.updateVisuals(healthPercent)
      })
      this.updateVisuals(this.lampHealthManager.getHealthPercent())
      print(`${LOG_TAG} Subscribed to LampHealthManager events`)
    } else {
      print(`${LOG_TAG} WARNING: lampHealthManager not wired`)
    }
  }

  private updateVisuals(healthPercent: number) {
    const fillAmount = 1.0 - (healthPercent / 100)

    if (this.overlayMat) {
      this.overlayMat.mainPass[this.fillPropertyName] = fillAmount
    }
  }
}
