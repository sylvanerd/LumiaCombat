import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {CancelToken, clearTimeout, setTimeout} from "SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils"
import {LSTween} from "Spectacles 3D Hand Hints.lspkg/LSTween/LSTween"

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
  @hint("Start the onboarding sequence automatically when the lens opens")
  autoStart: boolean = true

  // Tips canvas: a static logo + a single line of text that fades out, swaps to the
  // next tip, then fades back in. Shown together with bluetoothMenuRoot so the user
  // has something to read while the Bluetooth pairing flow runs.
  @input
  @allowUndefined
  @hint("Tips canvas root revealed alongside the Bluetooth menu after Go Physical")
  tipsRoot: SceneObject

  @input
  @allowUndefined
  @hint("Text component for the fading tip line. Authored color is preserved; only alpha is tweened.")
  tipText: Text

  @input
  @allowUndefined
  @hint("Fun-fact lines cycled in order. Empty array disables the roller.")
  tips: string[]

  @input
  @hint("Seconds each tip stays fully visible before fading out")
  tipDurationSeconds: number = 10

  @input
  @hint("Seconds for one fade segment (fade-out OR fade-in)")
  tipFadeDurationSeconds: number = 0.4

  public readonly onSequenceComplete: Event<void> = new Event<void>()

  private isShowing: boolean = false

  // Tip roller state. tipBaseColor is captured lazily on first run so the artist
  // can author the tip color in the Inspector and we only modulate its alpha.
  private tipIndex: number = 0
  private tipBaseColor: vec4 = null
  private tipDwellToken: CancelToken = null
  private tipFadeOutToken: CancelToken = null
  private tipFadeInToken: CancelToken = null

  onAwake() {
    this.setRootEnabled(this.introCard, false)
    this.setRootEnabled(this.bluetoothMenuRoot, false)
    this.setRootEnabled(this.tipsRoot, false)

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
    // Defensive: if the lens loops back to the intro, kill any in-flight tip timers.
    this.stopTipsRoller()
  }

  dismiss() {
    if (!this.isShowing || !this.introCard) return

    this.setRootEnabled(this.introCard, false)
    this.stopTipsRoller()
    this.isShowing = false
    this.onSequenceComplete.invoke()
  }

  onGoPhysicalPressed(on: boolean) {
    if (!on) {
      return
    }

    this.transitionFromIntro(() => {
      this.setRootEnabled(this.bluetoothMenuRoot, true)
      // Tips canvas comes up at the same beat as the Bluetooth menu so the user
      // always has something to read while pairing.
      this.setRootEnabled(this.tipsRoot, true)
      this.startTipsRoller()
    })
  }

  onGoVirtualPressed(on: boolean) {
    // Intentionally empty: the virtual option is presented as Coming Soon in the UI.
  }

  onSkipPressed() {
    this.setRootEnabled(this.introCard, false)
    this.setRootEnabled(this.bluetoothMenuRoot, false)
    this.stopTipsRoller()
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

  // ----- Tips roller -----
  // Cycle: dwell (tipDurationSeconds) -> fade-out (tipFadeDurationSeconds) ->
  // swap text while invisible -> fade-in (tipFadeDurationSeconds) -> dwell again.
  // Only the alpha of tipText.textFill.color animates; the logo (a sibling under
  // tipsRoot) is never touched.

  private startTipsRoller() {
    if (!this.tipsRoot || !this.tipText || !this.tips || this.tips.length === 0) {
      return
    }

    // Capture once: subsequent alpha tweens reuse the artist-authored RGB.
    if (this.tipBaseColor === null) {
      this.tipBaseColor = this.tipText.textFill.color
    }

    // Drop any timers from a previous run before starting a new cycle.
    this.clearTipTokens()

    this.tipIndex = 0
    this.tipText.text = this.tips[this.tipIndex]
    this.setTipAlpha(1)

    this.tipDwellToken = setTimeout(() => {
      this.fadeOutAndAdvance()
    }, this.tipDurationSeconds * 1000)
  }

  private stopTipsRoller() {
    this.clearTipTokens()
    // Restore full alpha so the next show() leaves the text in a clean state and
    // the artist can still see it in Lens Studio if they re-enable tipsRoot manually.
    if (this.tipText && this.tipBaseColor !== null) {
      this.setTipAlpha(1)
    }
    this.setRootEnabled(this.tipsRoot, false)
  }

  private fadeOutAndAdvance() {
    if (!this.tipText || !this.tips || this.tips.length === 0) return

    const fadeMs = this.tipFadeDurationSeconds * 1000
    LSTween.rawTween(fadeMs)
      .onUpdate((data) => {
        this.setTipAlpha(1 - (data.t as number))
      })
      .start()

    // Wait the same fade duration, then swap the text while it's at alpha 0 so
    // the swap is invisible to the user. Chained via setTimeout because the
    // codebase already uses LSTween.rawTween + SIK setTimeout for sequencing.
    this.tipFadeOutToken = setTimeout(() => {
      this.tipIndex = (this.tipIndex + 1) % this.tips.length
      this.tipText.text = this.tips[this.tipIndex]
      this.setTipAlpha(0)
      this.fadeInCurrentTip()
    }, fadeMs)
  }

  private fadeInCurrentTip() {
    if (!this.tipText) return

    const fadeMs = this.tipFadeDurationSeconds * 1000
    LSTween.rawTween(fadeMs)
      .onUpdate((data) => {
        this.setTipAlpha(data.t as number)
      })
      .start()

    // After the fade-in finishes, dwell for tipDurationSeconds before the next roll.
    this.tipFadeInToken = setTimeout(() => {
      this.tipDwellToken = setTimeout(() => {
        this.fadeOutAndAdvance()
      }, this.tipDurationSeconds * 1000)
    }, fadeMs)
  }

  private setTipAlpha(a: number) {
    if (!this.tipText || this.tipBaseColor === null) return
    const c = this.tipBaseColor
    // textFill.color is a vec4; assigning a fresh vec4 is the supported way to
    // mutate its alpha on a Text component.
    this.tipText.textFill.color = new vec4(c.x, c.y, c.z, a)
  }

  private clearTipTokens() {
    if (this.tipDwellToken) {
      clearTimeout(this.tipDwellToken)
      this.tipDwellToken = null
    }
    if (this.tipFadeOutToken) {
      clearTimeout(this.tipFadeOutToken)
      this.tipFadeOutToken = null
    }
    if (this.tipFadeInToken) {
      clearTimeout(this.tipFadeInToken)
      this.tipFadeInToken = null
    }
  }
}
