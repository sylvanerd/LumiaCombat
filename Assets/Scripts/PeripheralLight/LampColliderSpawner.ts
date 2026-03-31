import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {LightHandEventListener} from "./LightHandEventListener"

const LOG_TAG = "[LampCollider]"

@component
export class LampColliderSpawner extends BaseScriptComponent {
  @input
  @hint("The LightHandEventListener on this prefab, used to poll surfaceDetectionPosition")
  lightHandEventListener: LightHandEventListener

  @input
  @hint("Prefab with a sphere ColliderComponent (intangible=true, FitVisual=true) and optional transparent mesh")
  colliderPrefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Sound effect played when the ball hits the lamp collider")
  hitSound: AudioComponent

  get onBallCollision() {
    return this._onBallCollision.publicApi()
  }

  private _onBallCollision: Event<ColliderComponent> = new Event<ColliderComponent>()

  private colliderInstance: SceneObject = null
  private pollEvent: SceneEvent = null
  private placed: boolean = false

  onAwake() {
    this.placed = false
    this.pollEvent = this.createEvent("UpdateEvent")
    this.pollEvent.bind(() => this.pollForAnchor())
  }

  private pollForAnchor() {
    if (this.placed) return
    if (this.lightHandEventListener.surfaceDetectionPosition === undefined) return

    this.placed = true
    this.pollEvent.enabled = false
    this.spawnCollider(this.lightHandEventListener.surfaceDetectionPosition)
  }

  private spawnCollider(pos: vec3) {
    print(`${LOG_TAG} Spawning lamp collider at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`)

    this.colliderInstance = this.colliderPrefab.instantiate(null)
    this.colliderInstance.getTransform().setWorldPosition(pos)

    const collider = this.findCollider(this.colliderInstance)
    if (!collider) {
      print(`${LOG_TAG} WARNING: No ColliderComponent found on collider prefab`)
      return
    }

    collider.onOverlapEnter.add((args: OverlapEnterEventArgs) => {
      this.onOverlap(args)
    })

    print(`${LOG_TAG} Lamp collider active, listening for overlap events`)
  }

  private findCollider(obj: SceneObject): ColliderComponent {
    const c = obj.getComponent("Physics.ColliderComponent") as ColliderComponent
    if (c) return c

    for (let i = 0; i < obj.getChildrenCount(); i++) {
      const found = this.findCollider(obj.getChild(i))
      if (found) return found
    }
    return null
  }

  private onOverlap(args: OverlapEnterEventArgs) {
    const otherCollider = args.overlap.collider
    const otherName = otherCollider.getSceneObject().name
    print(`${LOG_TAG} Overlap detected with: ${otherName}`)

    if (otherName === "Sphere") {
      print(`${LOG_TAG} Ball collision confirmed!`)
      if (this.hitSound) {
        this.hitSound.play(1)
      }
      this._onBallCollision.invoke(otherCollider)
    }
  }
}
