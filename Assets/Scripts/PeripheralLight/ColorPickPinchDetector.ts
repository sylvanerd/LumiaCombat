import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

const LOG_TAG = "[ColorPick]"

@component
export class ColorPickPinchDetector extends BaseScriptComponent {
  @input
  @hint("Minimum seconds to hold pinch before triggering")
  holdDuration: number = 2

  @input
  @hint("Enable a short forgiveness window for brief pinch-tracking loss")
  useGracePeriod: boolean = true

  @input
  @hint("Seconds to forgive brief pinch-tracking loss before resetting the hold")
  gracePeriod: number = 0.3

  get onPinchHeld() {
    return this._onPinchHeld.publicApi()
  }

  private _onPinchHeld: Event<TrackedHand> = new Event<TrackedHand>()

  private leftHand: TrackedHand
  private rightHand: TrackedHand

  private leftPinchStartTime: number = -1
  private rightPinchStartTime: number = -1
  private leftHasFired: boolean = false
  private rightHasFired: boolean = false
  private leftPinchLostTime: number = -1
  private rightPinchLostTime: number = -1

  suppressed: boolean = false
  private wasSuppressed: boolean = false

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    const handInputData = SIK.HandInputData
    this.leftHand = handInputData.getHand("left")
    this.rightHand = handInputData.getHand("right")

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    print(`${LOG_TAG} PinchDetector initialized. holdDuration=${this.holdDuration}s, useGracePeriod=${this.useGracePeriod}, gracePeriod=${this.gracePeriod}s`)
  }

  private onUpdate() {
    if (this.suppressed && !this.wasSuppressed) {
      this.resetHand("left")
      this.resetHand("right")
    }
    this.wasSuppressed = this.suppressed

    this.trackHand(this.leftHand, "left")
    this.trackHand(this.rightHand, "right")
  }

  private trackHand(hand: TrackedHand, label: string) {
    const isActive = !this.suppressed && hand && hand.isTracked() && hand.isPinching()

    if (isActive) {
      this.setPinchLostTime(label, -1)

      const startTime = this.getPinchStartTime(label)
      if (startTime < 0) {
        this.setPinchStartTime(label, getTime())
        print(`${LOG_TAG} Pinch detected on ${label} hand`)
        return
      }

      const elapsed = getTime() - startTime
      const hasFired = this.getHasFired(label)

      if (!hasFired && elapsed >= this.holdDuration) {
        print(`${LOG_TAG} Pinch hold complete on ${label} hand! (held ${elapsed.toFixed(2)}s)`)
        this.setHasFired(label, true)
        this._onPinchHeld.invoke(hand)
      }
    } else {
      if (this.getPinchStartTime(label) < 0) return

      if (!this.useGracePeriod) {
        this.logPinchLost(label)
        this.resetHand(label)
        return
      }

      const lostTime = this.getPinchLostTime(label)
      if (lostTime < 0) {
        this.setPinchLostTime(label, getTime())
        return
      }

      const lostDuration = getTime() - lostTime
      if (lostDuration > this.gracePeriod) {
        this.logPinchLost(label)
        this.resetHand(label)
      }
    }
  }

  private logPinchLost(label: string) {
    if (this.getHasFired(label)) return

    const elapsed = getTime() - this.getPinchStartTime(label)
    if (elapsed > 0.1) {
      print(`${LOG_TAG} Pinch lost on ${label} hand after ${elapsed.toFixed(2)}s (not long enough)`)
    }
  }

  private getPinchStartTime(label: string): number {
    return label === "right" ? this.rightPinchStartTime : this.leftPinchStartTime
  }

  private setPinchStartTime(label: string, time: number) {
    if (label === "right") {
      this.rightPinchStartTime = time
    } else {
      this.leftPinchStartTime = time
    }
  }

  private getHasFired(label: string): boolean {
    return label === "right" ? this.rightHasFired : this.leftHasFired
  }

  private setHasFired(label: string, val: boolean) {
    if (label === "right") {
      this.rightHasFired = val
    } else {
      this.leftHasFired = val
    }
  }

  private getPinchLostTime(label: string): number {
    return label === "right" ? this.rightPinchLostTime : this.leftPinchLostTime
  }

  private setPinchLostTime(label: string, time: number) {
    if (label === "right") {
      this.rightPinchLostTime = time
    } else {
      this.leftPinchLostTime = time
    }
  }

  private resetHand(label: string) {
    this.setPinchStartTime(label, -1)
    this.setHasFired(label, false)
    this.setPinchLostTime(label, -1)
  }
}
