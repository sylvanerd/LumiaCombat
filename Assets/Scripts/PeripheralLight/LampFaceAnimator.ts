/**
 * Drives the lamp's facial expression by swapping `baseTex` on a face quad's
 * cloned material. Mirrors the existing LampHaloVFXController pattern for
 * singleton resolution (poll until ready, then subscribe).
 *
 * State machine (priority high -> low):
 *   Terminal (one-shot, hold forever): Dead, Victorious
 *   Overlay  (timed, transient):       Attack, Damage
 *   Base     (blink loop):             TutorialBlink, NormalBlink,
 *                                      WarningBlink, CriticalBlink
 *
 * Every blink layer alternates [stateOpenFrame] <-> [sharedBlinkClosedFrame]
 * with configurable open/closed dwell. Overlays interrupt the blink for a
 * fixed hold, then the loop resumes against whatever base state is current
 * (so a damage flash during low-HP returns to the low-HP loop, not normal).
 *
 * The face quad lives inside LampOnboarding.prefab, which is instantiated at
 * runtime by LampColliderSpawner once the player places the light. All scene
 * singletons (LampHealthManager, PlayerHealthManager, GameLogicManager) are
 * therefore alive by the time this script's onAwake runs; the polling
 * fallback is a safety net for any future script-ordering changes.
 *
 * AutoBallShooter is taken as an @input rather than a singleton because it
 * isn't registered as one today.
 */

import {GameLogicManager} from "Scripts/GameLogicManager"
import {AutoBallShooter} from "./AutoBallShooter"
import {LampHealthManager} from "./LampHealthManager"
import {PlayerHealthManager} from "./PlayerHealthManager"

const LOG_TAG = "[LampFaceAnimator]"

type BaseState = "tutorial" | "normal" | "warning" | "critical"
type OverlayKind = "attack" | "damage"
type TerminalKind = "dead" | "victorious"

@component
export class LampFaceAnimator extends BaseScriptComponent {
  @ui.separator
  @ui.label("Render target")

  @input
  @hint("RenderMeshVisual on the face quad. Material is cloned on Awake and baseTex is swapped per frame change.")
  faceMeshVisual: RenderMeshVisual

  @ui.separator
  @ui.label("Frame textures")

  @input
  @hint("Shared closed-eyes blink frame used by every blinking state (Tutorial / Normal / Warning / Critical)")
  blinkClosedFrame: Texture

  @input
  @allowUndefined
  @hint("Tutorial open frame (eyes fully open, looking up). If unset, falls back to normalOpenFrame.")
  tutorialOpenFrame: Texture

  @input
  @hint("Normal open frame -- the default mid-game blink while HP is above the warning threshold")
  normalOpenFrame: Texture

  @input
  @hint("Attack frame (one eye squinted, mouth open). Held for attackHoldDuration when a ball spawns.")
  attackFrame: Texture

  @input
  @hint("Damage frame (eyes wide, mouth O). Held for damageHoldDuration when the lamp takes a hit.")
  damageFrame: Texture

  @input
  @hint("Warning open frame (droopy eyes, frown). Shown while HP is between the critical and warning thresholds.")
  warningOpenFrame: Texture

  @input
  @hint("Critical open frame (more droopy, mouth open). Shown while HP is below the critical threshold.")
  criticalOpenFrame: Texture

  @input
  @hint("Dead frame (X eyes, flat mouth). Held indefinitely when the lamp dies (player wins).")
  deadFrame: Texture

  @input
  @hint("Victorious frame (smug squint, full smile). Held indefinitely when the player dies (lamp wins).")
  victoriousFrame: Texture

  @ui.separator
  @ui.label("Timing (seconds)")

  @input
  @hint("How long the open-eye frame holds before each blink")
  blinkOpenDuration: number = 2.5

  @input
  @hint("How long the closed-eye frame holds during each blink")
  blinkClosedDuration: number = 0.15

  @input
  @hint("How long the attack frame holds before returning to the blink loop")
  attackHoldDuration: number = 1.0

  @input
  @hint("How long the damage frame holds before returning to the blink loop")
  damageHoldDuration: number = 1.0

  @ui.separator
  @ui.label("HP thresholds (% of max)")

  @input
  @hint("Below this HP the face switches to the Warning expression (default mirrors LampCircularHealthBar.warningThresholdPct)")
  warningThresholdPct: number = 50

  @input
  @hint("Below this HP the face switches to the Critical expression (default mirrors LampHealthManager.lowHealthThreshold)")
  criticalThresholdPct: number = 25

  @ui.separator
  @ui.label("External references")

  @input
  @hint("AutoBallShooter ScriptComponent on the lamp scene root. Drives the Attack expression via its onBallSpawned event.")
  autoBallShooter: AutoBallShooter

  private faceMat: Material = null
  private currentTex: Texture = null

  private lampHealth: LampHealthManager = null
  private playerHealth: PlayerHealthManager = null
  private gameLogic: GameLogicManager = null
  private subscribed: boolean = false

  private gameStarted: boolean = false
  private baseState: BaseState = "tutorial"
  private overlay: OverlayKind = null
  private overlayStart: number = 0
  private terminal: TerminalKind = null

  private blinkOpen: boolean = true
  private blinkPhaseStart: number = 0
  private lastHealthPct: number = 100

  onAwake() {
    if (!this.faceMeshVisual) {
      print(`${LOG_TAG} ERROR: faceMeshVisual not wired in Inspector; script disabled`)
      return
    }

    // Clone the source material so per-instance baseTex swaps don't bleed
    // across other consumers of the same material asset. Same pattern used in
    // GameLogicManager.registerDebugObject and LampCircularHealthBar.spawnHealthUI.
    const mat = this.faceMeshVisual.mainMaterial.clone()
    this.faceMeshVisual.mainMaterial = mat
    this.faceMat = mat

    this.blinkPhaseStart = getTime()
    this.applyBaseFrame()

    this.createEvent("OnStartEvent").bind(() => this.tryBind())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private tryBind() {
    this.lampHealth = LampHealthManager.getInstance() as LampHealthManager
    this.playerHealth = PlayerHealthManager.getInstance() as PlayerHealthManager
    this.gameLogic = GameLogicManager.getInstance() as GameLogicManager

    if (this.lampHealth && this.playerHealth && this.gameLogic) {
      this.subscribe()
      return
    }

    print(`${LOG_TAG} Singletons not ready (lamp=${!!this.lampHealth}, player=${!!this.playerHealth}, logic=${!!this.gameLogic}); polling in update`)
  }

  private subscribe() {
    if (this.subscribed) return
    this.subscribed = true

    this.gameLogic.onGameStarted.add(() => this.onGameStarted())
    this.lampHealth.onHealthChanged.add((p: number) => this.onHealthChanged(p))
    this.lampHealth.onLampDied.add(() => this.enterTerminal("dead"))
    this.playerHealth.onPlayerDied.add(() => this.enterTerminal("victorious"))

    if (this.autoBallShooter) {
      this.autoBallShooter.onBallSpawned.add(() => this.enterOverlay("attack"))
    } else {
      print(`${LOG_TAG} WARNING: autoBallShooter not wired in Inspector; attack expression disabled`)
    }

    // Seed lastHealthPct from the live manager so the first onHealthChanged
    // compares against the actual current health rather than the 100 default.
    this.lastHealthPct = this.lampHealth.getHealthPercent()
    this.refreshBaseState()
    print(`${LOG_TAG} Subscribed to game state events (startingHp=${this.lastHealthPct.toFixed(1)}%, base=${this.baseState})`)
  }

  private onGameStarted() {
    if (this.gameStarted) return
    this.gameStarted = true
    this.refreshBaseState()
  }

  private onHealthChanged(healthPct: number) {
    // Epsilon comparison so float jitter doesn't spuriously trigger damage.
    const decreased = healthPct < this.lastHealthPct - 0.01
    this.lastHealthPct = healthPct

    this.refreshBaseState()

    if (decreased && !this.terminal) {
      this.enterOverlay("damage")
    }
  }

  private refreshBaseState() {
    const next = this.computeBaseState()
    if (next === this.baseState) return
    this.baseState = next
    print(`${LOG_TAG} Base state -> ${next}`)

    // Reflect the new base expression immediately if no overlay/terminal is
    // masking it. The blink phase is preserved so the loop doesn't stutter.
    if (!this.terminal && !this.overlay) {
      this.applyBaseFrame()
    }
  }

  private computeBaseState(): BaseState {
    if (!this.gameStarted) return "tutorial"
    const hp = this.lastHealthPct
    if (hp > this.warningThresholdPct) return "normal"
    if (hp > this.criticalThresholdPct) return "warning"
    return "critical"
  }

  private enterOverlay(kind: OverlayKind) {
    if (this.terminal) return
    this.overlay = kind
    this.overlayStart = getTime()
    const tex = kind === "attack" ? this.attackFrame : this.damageFrame
    this.setFrame(tex)
  }

  private enterTerminal(kind: TerminalKind) {
    this.terminal = kind
    this.overlay = null
    const tex = kind === "dead" ? this.deadFrame : this.victoriousFrame
    this.setFrame(tex)
    print(`${LOG_TAG} Terminal state -> ${kind}`)
  }

  private onUpdate() {
    // Lazy singleton resolution as a safety net for any future script-ordering
    // changes. Once subscribed, the polling cost drops to a single boolean check.
    if (!this.subscribed) {
      this.tryBind()
    }

    if (this.terminal) return

    const now = getTime()

    if (this.overlay) {
      const dur = this.overlay === "attack" ? this.attackHoldDuration : this.damageHoldDuration
      if (now - this.overlayStart >= dur) {
        this.overlay = null
        // Restart the loop on the open frame so the return is a deliberate
        // beat rather than a jarring mid-blink swap.
        this.blinkOpen = true
        this.blinkPhaseStart = now
        this.applyBaseFrame()
      }
      return
    }

    const phaseDur = this.blinkOpen ? this.blinkOpenDuration : this.blinkClosedDuration
    if (now - this.blinkPhaseStart >= phaseDur) {
      this.blinkOpen = !this.blinkOpen
      this.blinkPhaseStart = now
      this.applyBaseFrame()
    }
  }

  private applyBaseFrame() {
    const tex = this.blinkOpen ? this.openFrameForBase() : this.blinkClosedFrame
    this.setFrame(tex)
  }

  private openFrameForBase(): Texture {
    switch (this.baseState) {
      case "tutorial":
        return this.tutorialOpenFrame || this.normalOpenFrame
      case "normal":
        return this.normalOpenFrame
      case "warning":
        return this.warningOpenFrame
      case "critical":
        return this.criticalOpenFrame
    }
    return this.normalOpenFrame
  }

  private setFrame(tex: Texture) {
    if (!tex || !this.faceMat) return
    if (this.currentTex === tex) return
    this.currentTex = tex
    this.faceMat.mainPass.baseTex = tex
  }
}
