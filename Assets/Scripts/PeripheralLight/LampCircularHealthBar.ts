import {GameLogicManager} from "Scripts/GameLogicManager"
import {LampHealthManager} from "./LampHealthManager"
import {LightHandEventListener} from "./LightHandEventListener"

const LOG_TAG = "[LampBatteryHealthBar]"

@component
export class LampCircularHealthBar extends BaseScriptComponent {
  @input
  @hint("The LampHealthManager driving this health bar")
  lampHealthManager: LampHealthManager

  @input
  @hint("LightHandEventListener on the lamp prefab, used to read the placement position when the game starts")
  lightHandEventListener: LightHandEventListener

  @input
  @hint("Prefab containing the battery-bar health UI. Instantiated at the anchor position when the game starts.")
  healthUIPrefab: ObjectPrefab

  @input
  @hint("Y offset above the anchor position to spawn the health UI")
  yOffset: number = 30

  @input
  @hint("Name of the RenderMeshVisual child inside the prefab that carries the battery bar mesh and material")
  batteryBarChildName: string = "BatteryBar"

  @input
  @hint("Blend shape name on the battery-bar mesh that controls the fill level (0=empty, 1=full)")
  fillBlendShapeName: string = "pCube2"

  @input
  @hint("Optional secondary blend shape on the battery-bar mesh, held at a constant accent value")
  accentBlendShapeName: string = "pCube3"

  @input
  @hint("Constant weight to write into the accent blend shape (leave at 0 to disable)")
  accentValue: number = 0.1

  @input
  @hint("Name of the color (vec4) property on the battery-bar material to tint based on health")
  colorPropertyName: string = "baseColor"

  @input("vec4")
  @widget(new ColorWidget())
  @hint("Color at 100% health")
  healthyColor: vec4 = new vec4(0.2, 1.0, 0.4, 1.0)

  @input("vec4")
  @widget(new ColorWidget())
  @hint("Color at the warning threshold")
  warningColor: vec4 = new vec4(1.0, 0.85, 0.2, 1.0)

  @input("vec4")
  @widget(new ColorWidget())
  @hint("Color at 0% health")
  dangerColor: vec4 = new vec4(1.0, 0.25, 0.25, 1.0)

  @input
  @hint("Health % at which the bar reaches warningColor; below this it lerps toward dangerColor")
  warningThresholdPct: number = 50

  @input
  @hint("If true, slide the battery bar's local position as it shrinks so the chosen edge stays anchored. Disable for a symmetric shrink around the center.")
  anchorEdge: boolean = true

  @input("vec3")
  @showIf("anchorEdge", true)
  @hint("Local-space offset applied to the battery bar when it is fully empty (health=0). Linearly interpolated based on health: empty offset blends to zero at full health. For a horizontal bar of local width 4 anchored to its left edge, use (-2, 0, 0).")
  emptyShiftOffset: vec3 = new vec3(-2.0, 0.0, 0.0)

  private batteryBarMesh: RenderMeshVisual | null = null
  private batteryBarMat: Material | null = null
  private batteryBarTransform: Transform | null = null
  private batteryBarOriginalPos: vec3 | null = null
  private placed: boolean = false
  private healthUIInstance: SceneObject

  onAwake() {
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

    this.batteryBarMesh = this.findRenderMeshByName(this.healthUIInstance, this.batteryBarChildName)
    if (this.batteryBarMesh) {
      this.batteryBarMat = this.batteryBarMesh.mainMaterial.clone()
      this.batteryBarMesh.mainMaterial = this.batteryBarMat

      this.batteryBarTransform = this.batteryBarMesh.getSceneObject().getTransform()
      this.batteryBarOriginalPos = this.batteryBarTransform.getLocalPosition()

      if (this.accentBlendShapeName && this.batteryBarMesh.hasBlendShapeWeight(this.accentBlendShapeName)) {
        this.batteryBarMesh.setBlendShapeWeight(this.accentBlendShapeName, this.accentValue)
      }

      print(`${LOG_TAG} Battery bar found, material cloned, fill blend shape="${this.fillBlendShapeName}", color prop="${this.colorPropertyName}"`)
    } else {
      print(`${LOG_TAG} WARNING: Could not find RenderMeshVisual named "${this.batteryBarChildName}" in health UI prefab`)
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
    const fillAmount = Math.max(0, Math.min(1, healthPercent / 100))

    if (this.batteryBarMesh && this.batteryBarMesh.hasBlendShapeWeight(this.fillBlendShapeName)) {
      this.batteryBarMesh.setBlendShapeWeight(this.fillBlendShapeName, fillAmount)
    }

    if (this.batteryBarMat) {
      const color = this.healthToColor(healthPercent)
      this.batteryBarMat.mainPass[this.colorPropertyName] = color
    }

    if (this.anchorEdge && this.batteryBarTransform && this.batteryBarOriginalPos) {
      const t = 1 - fillAmount
      const newPos = new vec3(
        this.batteryBarOriginalPos.x + this.emptyShiftOffset.x * t,
        this.batteryBarOriginalPos.y + this.emptyShiftOffset.y * t,
        this.batteryBarOriginalPos.z + this.emptyShiftOffset.z * t
      )
      this.batteryBarTransform.setLocalPosition(newPos)
    }
  }

  private healthToColor(healthPercent: number): vec4 {
    const threshold = Math.max(1, Math.min(99, this.warningThresholdPct))

    if (healthPercent >= threshold) {
      const t = (healthPercent - threshold) / (100 - threshold)
      return this.lerpColor(this.warningColor, this.healthyColor, t)
    } else {
      const t = healthPercent / threshold
      return this.lerpColor(this.dangerColor, this.warningColor, t)
    }
  }

  private lerpColor(a: vec4, b: vec4, t: number): vec4 {
    const clampedT = Math.max(0, Math.min(1, t))
    return new vec4(
      a.x + (b.x - a.x) * clampedT,
      a.y + (b.y - a.y) * clampedT,
      a.z + (b.z - a.z) * clampedT,
      a.w + (b.w - a.w) * clampedT
    )
  }
}
