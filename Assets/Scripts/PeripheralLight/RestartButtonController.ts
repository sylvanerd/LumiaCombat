/**
 * RestartButtonController
 *
 * Lives on the SceneObject hosting the Restart PinchButton inside
 * LampOnboarding.prefab. The prefab is runtime-instantiated by
 * LampColliderSpawner once the player places the light, so GameLogicManager
 * cannot reach this SceneObject through a scene-time `@input`. Instead, we
 * self-register as a singleton (matching the ColorHistoryBar / LampHealthManager
 * pattern) and expose setVisible() so GameLogicManager can show the button on
 * win/lose and hide it on restart.
 *
 * The SceneObject is disabled in onAwake so the button stays hidden until the
 * first end-state event fires.
 */

const LOG_TAG = "[RestartButtonController]"

@component
export class RestartButtonController extends BaseScriptComponent {
  private static instance: RestartButtonController

  static getInstance(): RestartButtonController | undefined {
    return RestartButtonController.instance
  }

  onAwake() {
    if (RestartButtonController.instance) {
      print(`${LOG_TAG} WARNING: Multiple instances detected`)
    }
    RestartButtonController.instance = this

    this.setVisible(false)
    print(`${LOG_TAG} Singleton initialized (hidden)`)
  }

  setVisible(visible: boolean) {
    this.getSceneObject().enabled = visible
  }
}
