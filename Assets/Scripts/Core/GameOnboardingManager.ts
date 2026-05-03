import {ToggleButton} from "SpectaclesInteractionKit.lspkg/Components/UI/ToggleButton/ToggleButton"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

@component
export class GameOnboardingManager extends BaseScriptComponent {
  @input
  @hint("The intro card or intro canvas root SceneObject in the scene")
  introCard: SceneObject

  @input
  @allowUndefined
  @hint("Existing Bluetooth menu/canvas visual root to reveal after Go Physical")
  bluetoothMenuRoot: SceneObject

  @input
  @allowUndefined
  @hint("Optional game rules/tutorial intro root shown after Bluetooth setup")
  tutorialIntroRoot: SceneObject

  @input
  @allowUndefined
  @hint("Optional existing Bluetooth scan toggle to start when Go Physical is pressed")
  scanToggle: ToggleButton

  @input
  @hint("Start the onboarding sequence automatically when the lens opens")
  autoStart: boolean = true

  @input
  @hint("Automatically start Bluetooth scanning when Go Physical is pressed")
  autoStartScanOnPhysical: boolean = false

  public readonly onSequenceComplete: Event<void> = new Event<void>()

  private isShowing: boolean = false

  onAwake() {
    this.setRootEnabled(this.introCard, false)
    this.setRootEnabled(this.bluetoothMenuRoot, false)
    this.setRootEnabled(this.tutorialIntroRoot, false)

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
    this.setRootEnabled(this.introCard, true)
    this.setRootEnabled(this.bluetoothMenuRoot, false)
    this.setRootEnabled(this.tutorialIntroRoot, false)
  }

  dismiss() {
    if (!this.isShowing || !this.introCard) return

    this.setRootEnabled(this.introCard, false)
    this.isShowing = false
    this.onSequenceComplete.invoke()
  }

  onGoPhysicalPressed(on: boolean) {
    if (!on) {
      return
    }

    this.transitionFromIntro(() => {
      this.setRootEnabled(this.bluetoothMenuRoot, true)

      if (this.autoStartScanOnPhysical && this.scanToggle) {
        this.scanToggle.isToggledOn = true
      }
    })
  }

  onGoVirtualPressed(on: boolean) {
    // Intentionally empty: the virtual option is presented as Coming Soon in the UI.
  }

  onShowTutorialIntroPressed() {
    this.setRootEnabled(this.bluetoothMenuRoot, false)
    this.setRootEnabled(this.tutorialIntroRoot, true)
  }

  onSkipPressed() {
    this.setRootEnabled(this.introCard, false)
    this.setRootEnabled(this.bluetoothMenuRoot, false)
    this.setRootEnabled(this.tutorialIntroRoot, false)
    this.isShowing = false
    this.onSequenceComplete.invoke()
  }

  private transitionFromIntro(onComplete: () => void) {
    this.setRootEnabled(this.introCard, false)
    this.isShowing = false
    onComplete()
  }

  private setRootEnabled(root: SceneObject, enabled: boolean) {
    if (root) {
      root.enabled = enabled
    }
  }
}
