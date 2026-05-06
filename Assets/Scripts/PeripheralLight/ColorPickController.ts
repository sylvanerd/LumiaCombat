import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {GeminiTypes} from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {BallSpawnVFXController} from "./BallSpawnVFXController"
import {ColorPickPinchDetector} from "./ColorPickPinchDetector"
import {HandLatticeVFXController} from "./HandLatticeVFXController"
import {HueEventEmitter} from "./HueEventEmitter"

let _colorPickInstance: ColorPickController = null

const LOG_TAG = "[ColorPick]"
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash"
const GEMINI_MODEL_LITE = "gemini-2.5-flash-lite"

const SYSTEM_PROMPT =
  "Detect the dominant color of the object nearest the pinched index and thumb fingertips. " +
  "Ignore hands/fingers. Return exactly one JSON object with integer r, g, and b values from 0 to 255. " +
  "Do not include markdown, code fences, explanation, or any text outside the JSON object."

@component
export class ColorPickController extends BaseScriptComponent {
  @input
  pinchDetector: ColorPickPinchDetector

  @input
  @hint("Camera Module asset from the scene (same one used by DepthCache)")
  camModule: CameraModule

  // ---------------------------------------------------------------------------
  // Gemini Image Crop
  // ---------------------------------------------------------------------------
  @ui.separator
  @ui.label("Gemini Image Crop")

  @input
  @hint("Send a centered cropped camera region to Gemini instead of the full frame")
  useCenterCrop: boolean = true

  @input
  @hint("Screen Crop Texture asset used for centered Gemini crop")
  @allowUndefined
  centerCropTexture: Texture

  @input
  @hint("Centered frame fraction to send to Gemini. 0.3 = middle 30% width and height")
  centerCropScale: number = 0.3

  // ---------------------------------------------------------------------------
  // Ball & Gesture Settings
  // ---------------------------------------------------------------------------
  @ui.separator
  @ui.label("Ball & Gesture")

  @input
  mainCam: SceneObject

  @input
  @hint("Sphere prefab with Unlit alpha-blend material")
  ballPrefab: ObjectPrefab

  @input
  @hint("Scale units per second the ball grows")
  growSpeed: number = 1.0

  @input
  @hint("Target uniform scale of the fully grown ball")
  finalBallSize: number = 3.0

  @input
  @hint("How quickly the ball follows the fingertips (higher = snappier)")
  ballFollowSpeed: number = 15.0

  @input
  @hint("Multiplier for hand velocity (higher = more responsive to hand movement)")
  handVelocityMultiplier: number = 0.3

  @input
  @hint("Base forward force added to throws (guided by camera forward direction)")
  baseThrowForce: number = 800.0

  @input
  @hint("Pinch strength below this triggers a freeze-release (0-1)")
  minPinchStrength: number = 0.3

  @input
  @hint("Use gemini-2.5-flash-lite (faster) instead of gemini-2.5-flash (more accurate)")
  useLiteModel: boolean = false

  @input
  @hint("Hand lattice VFX controller for visual feedback on hand mesh")
  @allowUndefined
  latticeVFX: HandLatticeVFXController

  private hueEventEmitter: HueEventEmitter = null

  static getInstance(): ColorPickController {
    return _colorPickInstance
  }

  private get geminiModel(): string {
    return this.useLiteModel ? GEMINI_MODEL_LITE : GEMINI_MODEL_DEFAULT
  }

  setHueEventEmitter(emitter: HueEventEmitter) {
    this.hueEventEmitter = emitter
    print(`${LOG_TAG} HueEventEmitter registered dynamically`)
  }

  get onColorDetected() {
    return this._onColorDetected.publicApi()
  }

  private _onColorDetected: Event<vec4> = new Event<vec4>()

  private cameraTexture: Texture
  private latestFrame: Texture = null
  private isRequestRunning: boolean = false
  private pipelineStartTime: number = 0
  private mainCamTrans: Transform
  private lastDetectedColor: vec4 = null
  private hasWarnedMissingCropTexture: boolean = false

  private activeBall: SceneObject = null
  private activeBallMat: Material = null
  private activeBallVFX: BallSpawnVFXController = null
  private activeHand: TrackedHand = null
  private currentBallScale: number = 0

  private handVelocity: vec3 = vec3.zero()
  private previousHandPos: vec3 = null
  private ballActive: boolean = false
  private gestureModule: GestureModule = require("LensStudio:GestureModule") as GestureModule
  private lastPinchStrengthLeft: number = 1.0
  private lastPinchStrengthRight: number = 1.0

  onAwake() {
    _colorPickInstance = this
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    print(`${LOG_TAG} Controller initializing...`)

    this.mainCamTrans = this.mainCam.getTransform()

    this.startCamera()

    this.pinchDetector.onPinchHeld.add((hand: TrackedHand) => this.onPinchHeld(hand))

    this.setupGestureEvents()

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())

    print(`${LOG_TAG} Controller initialized. Model: ${this.geminiModel}`)
  }

  private startCamera() {
    print(`${LOG_TAG} Starting camera...`)
    const camRequest = CameraModule.createCameraRequest()
    camRequest.cameraId = CameraModule.CameraId.Left_Color
    this.cameraTexture = this.camModule.requestCamera(camRequest)

    const camTexControl = this.cameraTexture.control as CameraTextureProvider
    camTexControl.onNewFrame.add(() => {
      this.latestFrame = this.cameraTexture.copyFrame()
    })

    print(`${LOG_TAG} Camera started with CameraId.Left_Color, buffering frames via onNewFrame`)
  }

  private setupGestureEvents() {
    this.gestureModule.getFilteredPinchUpEvent(GestureModule.HandType.Left).add(() => {
      this.handlePinchUp(GestureModule.HandType.Left)
    })
    this.gestureModule.getFilteredPinchUpEvent(GestureModule.HandType.Right).add(() => {
      this.handlePinchUp(GestureModule.HandType.Right)
    })

    this.gestureModule.getPinchStrengthEvent(GestureModule.HandType.Left).add((args: PinchStrengthArgs) => {
      this.lastPinchStrengthLeft = args.strength
      this.checkPinchStrengthDrop()
    })
    this.gestureModule.getPinchStrengthEvent(GestureModule.HandType.Right).add((args: PinchStrengthArgs) => {
      this.lastPinchStrengthRight = args.strength
      this.checkPinchStrengthDrop()
    })

    print(`${LOG_TAG} GestureModule events wired (FilteredPinchUp + PinchStrength for both hands)`)
  }

  /** Pinch strength for the hand currently holding the ball (not min of both — avoids false freezes when one hand is open). */
  private getActiveHandPinchStrength(): number {
    if (!this.activeHand) return 1.0
    return this.activeHand.handType === "right"
      ? this.lastPinchStrengthRight
      : this.lastPinchStrengthLeft
  }

  private isBallFullyGrown(): boolean {
    return this.currentBallScale >= this.finalBallSize - 0.001
  }

  private handlePinchUp(releasedHand: GestureModule.HandType) {
    if (!this.ballActive || !this.activeBall || !this.activeHand) return

    const activeGestureHand =
      this.activeHand.handType === "right" ? GestureModule.HandType.Right : GestureModule.HandType.Left
    if (releasedHand !== activeGestureHand) {
      return
    }

    print(`${LOG_TAG} PinchUp on active hand — evaluating throw`)
    this.onPinchRelease()
  }

  private checkPinchStrengthDrop() {
    if (!this.ballActive || !this.activeBall || !this.activeHand) return

    const strength = this.getActiveHandPinchStrength()
    if (strength < this.minPinchStrength) {
      print(`${LOG_TAG} Active hand pinch strength dropped to ${strength.toFixed(2)} — freezing ball`)
      this.freezeBall()
    }
  }

  private freezeBall() {
    if (!this.ballActive || !this.activeBall) return
    print(`${LOG_TAG} Ball frozen in place (tracking/pinch edge case or release before full growth). Next pinch replaces it.`)
    this.cleanupAfterRelease()
  }

  private onPinchHeld(hand: TrackedHand) {
    if (this.isRequestRunning || this.ballActive) {
      print(`${LOG_TAG} Request already in progress or ball active, ignoring pinch`)
      return
    }

    this.pipelineStartTime = getTime()
    print(`${LOG_TAG} Pinch hold triggered! Using latest buffered frame...`)
    this.isRequestRunning = true

    if (this.latticeVFX) this.latticeVFX.startExtraction()

    this.spawnBall(hand)

    if (!this.latestFrame) {
      print(`${LOG_TAG} ERROR: No camera frame buffered yet, camera may still be starting`)
      this.isRequestRunning = false
      return
    }

    const frozenFrame = this.latestFrame
    const width = frozenFrame.getWidth()
    const height = frozenFrame.getHeight()
    print(`${LOG_TAG} Camera frame ready: ${width}x${height}`)

    const frameForGemini = this.getFrameForGemini(frozenFrame)
    print(`${LOG_TAG} Encoding image to Base64...`)

    const encodeStart = getTime()
    Base64.encodeTextureAsync(
      frameForGemini,
      (base64String: string) => {
        const encodeMs = ((getTime() - encodeStart) * 1000).toFixed(0)
        print(`${LOG_TAG} Image encoded in ${encodeMs}ms, length: ${base64String.length} chars`)
        this.sendGeminiColorRequest(base64String)
      },
      () => {
        print(`${LOG_TAG} ERROR: Image encoding failed!`)
        this.isRequestRunning = false
      },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }

  // ---------------------------------------------------------------------------
  // Gemini Image Crop
  // ---------------------------------------------------------------------------
  // Uses a Lens Studio Screen Crop Texture to crop the center of the camera frame
  // before JPEG/Base64 encoding. Toggle useCenterCrop off to send the full frame.
  private getFrameForGemini(sourceFrame: Texture): Texture {
    if (!this.useCenterCrop) {
      return sourceFrame
    }

    if (!this.centerCropTexture) {
      if (!this.hasWarnedMissingCropTexture) {
        print(`${LOG_TAG} WARNING: useCenterCrop is enabled but centerCropTexture is not assigned. Sending full frame.`)
        this.hasWarnedMissingCropTexture = true
      }
      return sourceFrame
    }

    const cropProvider = this.centerCropTexture.control as RectCropTextureProvider
    if (!cropProvider) {
      print(`${LOG_TAG} WARNING: centerCropTexture has no RectCropTextureProvider. Sending full frame.`)
      return sourceFrame
    }

    const cropScale = Math.max(0.05, Math.min(1.0, this.centerCropScale))
    cropProvider.inputTexture = sourceFrame
    cropProvider.cropRect = Rect.create(-cropScale, cropScale, -cropScale, cropScale)
    cropProvider.rotation = 0

    print(`${LOG_TAG} Center crop enabled: ${(cropScale * 100).toFixed(0)}% of frame, cropped size=${this.centerCropTexture.getWidth()}x${this.centerCropTexture.getHeight()}`)
    return this.centerCropTexture
  }

  private getPinchMidpoint(hand: TrackedHand): vec3 {
    const thumbPos = hand.thumbTip.position
    const indexPos = hand.indexTip.position
    return vec3.lerp(thumbPos, indexPos, 0.5)
  }

  private spawnBall(hand: TrackedHand) {
    if (this.activeBall) {
      this.activeBall.destroy()
      print(`${LOG_TAG} Destroyed previous ball`)
    }

    this.activeHand = hand
    this.currentBallScale = 0.1
    this.ballActive = true
    this.previousHandPos = null
    this.handVelocity = vec3.zero()
    this.activeBallVFX = null

    if (!this.ballPrefab) {
      print(`${LOG_TAG} WARNING: ballPrefab not assigned, skipping ball spawn`)
      return
    }

    const spawnPos = this.getPinchMidpoint(hand)
    this.activeBall = this.ballPrefab.instantiate(null)
    const tr = this.activeBall.getTransform()
    tr.setWorldPosition(spawnPos)
    tr.setLocalScale(vec3.one().uniformScale(this.currentBallScale))

    const placeholderColor = new vec4(0.9, 0.9, 0.9, 0.3)

    const rmv = this.activeBall.getComponent("RenderMeshVisual") as RenderMeshVisual
    if (rmv) {
      this.activeBallMat = rmv.mainMaterial.clone()
      rmv.mainMaterial = this.activeBallMat
      this.activeBallMat.mainPass.baseColor = placeholderColor
      print(`${LOG_TAG} Ball spawned at (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)}, ${spawnPos.z.toFixed(1)}) with transparent grey`)
    } else {
      print(`${LOG_TAG} WARNING: No RenderMeshVisual on ball prefab`)
    }

    this.activeBallVFX = this.activeBall.getComponent("ScriptComponent") as BallSpawnVFXController
    if (this.activeBallVFX && this.activeBallMat) {
      this.activeBallVFX.startMaterialize(this.activeBallMat, placeholderColor)
      print(`${LOG_TAG} Materialize VFX started`)
    }
  }

  public spawnPresetBall(hand: TrackedHand, color: vec4, presetScale: number) {
    if (this.ballActive || this.isRequestRunning) return

    this.spawnBall(hand)

    if (!this.activeBall) return

    this.currentBallScale = presetScale
    this.activeBall.getTransform().setLocalScale(
      vec3.one().uniformScale(presetScale)
    )

    this.lastDetectedColor = color

    if (this.activeBallVFX) {
      this.activeBallVFX.updateColor(color)
    } else if (this.activeBallMat) {
      this.activeBallMat.mainPass.baseColor = new vec4(color.r, color.g, color.b, 1.0)
    }

    if (this.latticeVFX) this.latticeVFX.applyColor(color)

    const hex = "#" +
      Math.round(color.r * 255).toString(16).padStart(2, "0") +
      Math.round(color.g * 255).toString(16).padStart(2, "0") +
      Math.round(color.b * 255).toString(16).padStart(2, "0")

    print(`${LOG_TAG} Preset ball spawned with color ${hex}, scale=${presetScale}`)
  }

  private geminiStartTime: number = 0

  private sendGeminiColorRequest(imageBase64: string) {
    print(`${LOG_TAG} Sending Gemini request with model: ${this.geminiModel}...`)
    this.geminiStartTime = getTime()

    const respSchema: GeminiTypes.Common.Schema = {
      type: "object",
      properties: {
        r: {type: "number"},
        g: {type: "number"},
        b: {type: "number"}
      },
      required: ["r", "g", "b"]
    }

    const reqObj: GeminiTypes.Models.GenerateContentRequest = {
      model: this.geminiModel,
      type: "generateContent",
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageBase64
                }
              },
              {
                text: "What is the dominant color of the object nearest to the fingertips in this image?"
              }
            ]
          }
        ],
        systemInstruction: {
          parts: [
            {
              text: SYSTEM_PROMPT
            }
          ]
        },
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          response_schema: respSchema,
          maxOutputTokens: 150
        }
      }
    }

    print(`${LOG_TAG} Gemini request body constructed, sending...`)

    Gemini.models(reqObj)
      .then((response) => {
        const geminiMs = ((getTime() - this.geminiStartTime) * 1000).toFixed(0)
        print(`${LOG_TAG} Gemini response received in ${geminiMs}ms!`)
        print(`${LOG_TAG} Gemini full response: ${JSON.stringify(response)}`)

        try {
          if (!response || !response.candidates || response.candidates.length === 0) {
            print(`${LOG_TAG} ERROR: No candidates in Gemini response`)
            this.isRequestRunning = false
            return
          }

          const candidate = response.candidates[0]
          if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            print(`${LOG_TAG} ERROR: No content parts in Gemini response. finishReason: ${candidate.finishReason}`)
            this.isRequestRunning = false
            return
          }

          const rawText = candidate.content.parts[0].text
          print(`${LOG_TAG} Gemini raw text: ${rawText}`)
          this.parseColorResponse(rawText)
        } catch (error) {
          print(`${LOG_TAG} ERROR: Failed to extract Gemini response: ${error}`)
          this.isRequestRunning = false
        }
      })
      .catch((error) => {
        const geminiMs = ((getTime() - this.geminiStartTime) * 1000).toFixed(0)
        print(`${LOG_TAG} ERROR: Gemini request failed after ${geminiMs}ms: ${error}`)
        this.isRequestRunning = false
      })
  }

  private parseColorResponse(rawText: string) {
    print(`${LOG_TAG} Parsing color response...`)

    try {
      const parsed = JSON.parse(rawText)

      const r: number = parsed.r !== undefined ? parsed.r : 0
      const g: number = parsed.g !== undefined ? parsed.g : 0
      const b: number = parsed.b !== undefined ? parsed.b : 0

      const hex = this.rgbToHex(r, g, b)

      print(`${LOG_TAG} Parsed color: hex=${hex}, rgb=(${r},${g},${b})`)

      const colorVec = new vec4(
        Math.max(0, Math.min(1, r / 255)),
        Math.max(0, Math.min(1, g / 255)),
        Math.max(0, Math.min(1, b / 255)),
        1
      )

      print(`${LOG_TAG} Color vec4: (${colorVec.r.toFixed(3)}, ${colorVec.g.toFixed(3)}, ${colorVec.b.toFixed(3)}, ${colorVec.a.toFixed(3)})`)

      this.applyColor(colorVec, hex)
    } catch (error) {
      print(`${LOG_TAG} ERROR: Failed to parse color response: ${error}`)
      print(`${LOG_TAG} Raw text was: ${rawText}`)
      this.isRequestRunning = false
    }
  }

  private applyColor(color: vec4, hex: string) {
    this.lastDetectedColor = color

    if (this.activeBallVFX) {
      this.activeBallVFX.updateColor(color)
      print(`${LOG_TAG} Ball color set to ${hex}`)
    } else if (this.activeBallMat) {
      this.activeBallMat.mainPass.baseColor = new vec4(color.r, color.g, color.b, 1.0)
      print(`${LOG_TAG} Ball color set to ${hex} (no VFX controller)`)
    }

    this._onColorDetected.invoke(color)
    if (this.latticeVFX) this.latticeVFX.applyColor(color)
    print(`${LOG_TAG} onColorDetected event fired with color ${hex}`)

    this.isRequestRunning = false
    const totalMs = ((getTime() - this.pipelineStartTime) * 1000).toFixed(0)
    print(`${LOG_TAG} --- Color pick cycle complete in ${totalMs}ms ---`)
  }

  private rgbToHex(r: number, g: number, b: number): string {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
    return "#" +
      clamp(r).toString(16).padStart(2, "0") +
      clamp(g).toString(16).padStart(2, "0") +
      clamp(b).toString(16).padStart(2, "0")
  }

  private onUpdate() {
    this.updateBall()
  }

  private updateBall() {
    if (!this.activeBall) return

    if (this.ballActive && this.activeHand && !this.activeHand.isTracked()) {
      print(`${LOG_TAG} Hand tracking lost while ball is active — freezing (no throw)`)
      this.freezeBall()
      return
    }

    if (this.activeHand && this.activeHand.isTracked() && this.ballActive) {
      const midpoint = this.getPinchMidpoint(this.activeHand)
      const currentPos = this.activeBall.getTransform().getWorldPosition()
      const smoothed = vec3.lerp(currentPos, midpoint, getDeltaTime() * this.ballFollowSpeed)
      this.activeBall.getTransform().setWorldPosition(smoothed)

      const currentHandPos = this.activeHand.indexTip.position
      if (this.previousHandPos !== null && getDeltaTime() > 0) {
        this.handVelocity = currentHandPos.sub(this.previousHandPos).uniformScale(1 / getDeltaTime())
      }
      this.previousHandPos = currentHandPos
    }

    if (this.ballActive && this.currentBallScale < this.finalBallSize) {
      this.currentBallScale = Math.min(
        this.currentBallScale + this.growSpeed * getDeltaTime(),
        this.finalBallSize
      )
      this.activeBall.getTransform().setLocalScale(
        vec3.one().uniformScale(this.currentBallScale)
      )
    }
  }

  private onPinchRelease() {
    if (!this.ballActive || !this.activeBall) return

    if (!this.isBallFullyGrown()) {
      print(`${LOG_TAG} Pinch release before ball finished growing — freeze in place (no throw)`)
      this.freezeBall()
      return
    }

    const body = this.activeBall.getComponent("Physics.BodyComponent") as BodyComponent
    if (!body) {
      print(`${LOG_TAG} WARNING: No Physics.BodyComponent on ball prefab`)
      this.cleanupAfterRelease()
      return
    }

    if (this.activeBallVFX && !this.activeBallVFX.isMaterialized) {
      this.activeBallVFX.forceComplete()
    }

    body.dynamic = true
    body.angularVelocity = vec3.zero()
    body.angularDamping = 0.95

    const ballPos = this.activeBall.getTransform().getWorldPosition()
    const camForward = this.mainCamTrans.forward.uniformScale(-1)
    const throwDirection = camForward.normalize()

    let throwStrength = this.handVelocity.length * this.handVelocityMultiplier

    if (throwStrength < 2) {
      throwStrength = this.baseThrowForce
    } else {
      throwStrength += this.baseThrowForce
    }

    const forceVector = throwDirection.uniformScale(throwStrength)

    body.addForce(forceVector, Physics.ForceMode.Impulse)
    print(`${LOG_TAG} Ball THROWN — strength: ${throwStrength.toFixed(1)}, direction: (${throwDirection.x.toFixed(2)}, ${throwDirection.y.toFixed(2)}, ${throwDirection.z.toFixed(2)}), hand speed: ${this.handVelocity.length.toFixed(1)}`)

    this.cleanupAfterRelease()
  }

  private cleanupAfterRelease() {
    this.activeHand = null
    this.handVelocity = vec3.zero()
    this.previousHandPos = null
    this.ballActive = false
    this.activeBallVFX = null
    if (this.latticeVFX) this.latticeVFX.cancelExtraction()
  }

  private findHueEventEmitterInScene(): HueEventEmitter {
    const rootCount = global.scene.getRootObjectsCount()
    for (let i = 0; i < rootCount; i++) {
      const found = this.searchForHue(global.scene.getRootObject(i))
      if (found) {
        print(`${LOG_TAG} Found HueEventEmitter on: ${found.getSceneObject().name}`)
        return found
      }
    }
    return null
  }

  private searchForHue(obj: SceneObject): HueEventEmitter {
    try {
      const scripts = obj.getComponents("Component.ScriptComponent")
      for (let s = 0; s < scripts.length; s++) {
        const script = scripts[s] as any
        if (script && typeof script.setColorUI === "function") {
          return script as HueEventEmitter
        }
      }
    } catch (e) { /* skip objects with no scripts */ }

    const childCount = obj.getChildrenCount()
    for (let c = 0; c < childCount; c++) {
      const found = this.searchForHue(obj.getChild(c))
      if (found) return found
    }
    return null
  }

}
