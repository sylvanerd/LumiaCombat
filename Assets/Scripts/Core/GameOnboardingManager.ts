import {LSTween} from "Spectacles 3D Hand Hints.lspkg/LSTween/LSTween"
import {Easing} from "Spectacles 3D Hand Hints.lspkg/LSTween/TweenJS/Easing"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

@component
export class GameOnboardingManager extends BaseScriptComponent {
  @input
  @hint("The intro card SceneObject in the scene")
  introCard: SceneObject

  @input
  @hint("Fade-in duration in seconds")
  fadeInDuration: number = 1

  @input
  @hint("Fade-out duration in seconds")
  fadeOutDuration: number = 1

  @input
  @hint("Start the onboarding sequence automatically when the lens opens")
  autoStart: boolean = true

  public readonly onSequenceComplete: Event<void> = new Event<void>()

  private isShowing: boolean = false

  onAwake() {
    if (this.introCard) {
      this.introCard.enabled = false
    }
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    if (this.autoStart) {
      this.show()
    }
  }

  show() {
    if (this.isShowing) return
    if (!this.introCard) {
      print("[GameOnboardingManager] Missing introCard input.")
      return
    }

    this.isShowing = true
    this.introCard.enabled = true

    LSTween.rawTween(this.fadeInDuration * 1000)
      .easing(Easing.Quadratic.InOut)
      .start()
  }

  dismiss() {
    if (!this.isShowing || !this.introCard) return

    LSTween.rawTween(this.fadeOutDuration * 1000)
      .easing(Easing.Quadratic.InOut)
      .onComplete(() => {
        this.introCard.enabled = false
        this.isShowing = false
        this.onSequenceComplete.invoke()
      })
      .start()
  }
}
