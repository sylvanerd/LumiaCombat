/**
 * Disables a target SceneObject when GameLogicManager.onGameStarted fires.
 * Attach to any object (typically the rules / tutorial UI card) and wire the
 * SceneObject you want to hide once the player presses Start Game.
 */

import {GameLogicManager} from "Scripts/GameLogicManager"

const LOG_TAG = "[DisableOnGameStart]"

@component
export class DisableOnGameStart extends BaseScriptComponent {
  @input
  @hint("SceneObject to disable when the player presses Start Game (GameLogicManager.startGame fires). Typically the rules / tutorial UI root.")
  target: SceneObject

  onAwake() {
    // GameLogicManager.instance is set in its own onAwake; defer subscription to
    // OnStartEvent so we don't depend on script execution order.
    this.createEvent("OnStartEvent").bind(() => this.subscribe())
  }

  private subscribe() {
    const manager = GameLogicManager.getInstance()
    if (!manager) {
      print(`${LOG_TAG} WARNING: GameLogicManager not found in scene; target will not be disabled`)
      return
    }
    manager.onGameStarted.add(() => this.onGameStarted())
    print(`${LOG_TAG} Subscribed to GameLogicManager.onGameStarted`)
  }

  private onGameStarted() {
    if (!this.target) {
      print(`${LOG_TAG} WARNING: target not assigned; nothing to disable`)
      return
    }
    this.target.enabled = false
    print(`${LOG_TAG} Disabled target SceneObject "${this.target.name}"`)
  }
}
