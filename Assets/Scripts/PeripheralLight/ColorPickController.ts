import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {GeminiTypes} from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {ColorPickPinchDetector} from "./ColorPickPinchDetector"
import {HueEventEmitter} from "./HueEventEmitter"

let _colorPickInstance: ColorPickController = null

const LOG_TAG = "[ColorPick]"
const GEMINI_MODEL = "gemini-2.0-flash"

const SYSTEM_PROMPT =
  "You are a color detection assistant. " +
  "The user is pinching their fingers near a real-world object. " +
  "Identify the dominant color of the object closest to the fingertips. " +
  "Ignore the fingers/hand themselves and focus on the object they are touching or pointing at. " +
  "Return ONLY a JSON object, no other text."

const CAM_DISTANCE = 60
const CAM_HEIGHT = -5

@component
export class ColorPickController extends BaseScriptComponent {
  @input
  pinchDetector: ColorPickPinchDetector

  @input
  @hint("Camera Module asset from the scene (same one used by DepthCache)")
  camModule: CameraModule

  @input
  @hint("SceneObject with RenderMeshVisual + Unlit material for color swatch")
  debugSwatchObj: SceneObject

  @input
  mainCam: SceneObject

  @input
  @hint("Optional text component for status messages")
  statusText: Text

  private hueEventEmitter: HueEventEmitter = null

  static getInstance(): ColorPickController {
    return _colorPickInstance
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
  private swatchTrans: Transform
  private swatchRmv: RenderMeshVisual
  private swatchMat: Material
  private lastDetectedColor: vec4 = null

  onAwake() {
    _colorPickInstance = this
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart() {
    print(`${LOG_TAG} Controller initializing...`)

    this.mainCamTrans = this.mainCam.getTransform()
    this.swatchTrans = this.debugSwatchObj.getTransform()

    this.swatchRmv = this.debugSwatchObj.getComponent("RenderMeshVisual") as RenderMeshVisual
    if (this.swatchRmv) {
      this.swatchMat = this.swatchRmv.mainMaterial.clone()
      this.swatchRmv.mainMaterial = this.swatchMat
      this.swatchMat.mainPass.baseColor = new vec4(0.2, 0.2, 0.2, 1)
      print(`${LOG_TAG} Debug swatch material cloned and ready`)
    } else {
      print(`${LOG_TAG} WARNING: No RenderMeshVisual found on debugSwatchObj`)
    }

    this.startCamera()

    this.pinchDetector.onPinchHeld.add(() => this.onPinchHeld())

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())

    this.setStatus("Color Pick ready. Pinch and hold to sample.")
    print(`${LOG_TAG} Controller initialized. Model: ${GEMINI_MODEL}`)
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

  private onPinchHeld() {
    if (this.isRequestRunning) {
      print(`${LOG_TAG} Request already in progress, ignoring pinch`)
      this.setStatus("Already analyzing... please wait")
      return
    }

    this.pipelineStartTime = getTime()
    print(`${LOG_TAG} Pinch hold triggered! Using latest buffered frame...`)
    this.setStatus("Capturing...")
    this.isRequestRunning = true

    if (!this.latestFrame) {
      print(`${LOG_TAG} ERROR: No camera frame buffered yet, camera may still be starting`)
      this.setStatus("Camera not ready yet, try again")
      this.isRequestRunning = false
      return
    }

    const frozenFrame = this.latestFrame
    const width = frozenFrame.getWidth()
    const height = frozenFrame.getHeight()
    print(`${LOG_TAG} Camera frame ready: ${width}x${height}`)

    print(`${LOG_TAG} Encoding image to Base64...`)
    this.setStatus("Encoding image...")

    const encodeStart = getTime()
    Base64.encodeTextureAsync(
      frozenFrame,
      (base64String: string) => {
        const encodeMs = ((getTime() - encodeStart) * 1000).toFixed(0)
        print(`${LOG_TAG} Image encoded in ${encodeMs}ms, length: ${base64String.length} chars`)
        this.sendGeminiColorRequest(base64String)
      },
      () => {
        print(`${LOG_TAG} ERROR: Image encoding failed!`)
        this.setStatus("ERROR: Image encoding failed")
        this.isRequestRunning = false
      },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }

  private geminiStartTime: number = 0

  private sendGeminiColorRequest(imageBase64: string) {
    print(`${LOG_TAG} Sending Gemini request with model: ${GEMINI_MODEL}...`)
    this.setStatus("Analyzing color with AI...")
    this.geminiStartTime = getTime()

    const respSchema: GeminiTypes.Common.Schema = {
      type: "object",
      properties: {
        hex: {type: "string"},
        r: {type: "number"},
        g: {type: "number"},
        b: {type: "number"},
        colorName: {type: "string"}
      },
      required: ["hex", "r", "g", "b", "colorName"]
    }

    const reqObj: GeminiTypes.Models.GenerateContentRequest = {
      model: GEMINI_MODEL,
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
          temperature: 0.1,
          responseMimeType: "application/json",
          response_schema: respSchema,
          maxOutputTokens: 200
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
            this.setStatus("ERROR: Empty Gemini response")
            this.isRequestRunning = false
            return
          }

          const candidate = response.candidates[0]
          if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            print(`${LOG_TAG} ERROR: No content parts in Gemini response. finishReason: ${candidate.finishReason}`)
            this.setStatus("ERROR: No content in response")
            this.isRequestRunning = false
            return
          }

          const rawText = candidate.content.parts[0].text
          print(`${LOG_TAG} Gemini raw text: ${rawText}`)
          this.parseColorResponse(rawText)
        } catch (error) {
          print(`${LOG_TAG} ERROR: Failed to extract Gemini response: ${error}`)
          this.setStatus("ERROR: Bad response structure")
          this.isRequestRunning = false
        }
      })
      .catch((error) => {
        const geminiMs = ((getTime() - this.geminiStartTime) * 1000).toFixed(0)
        print(`${LOG_TAG} ERROR: Gemini request failed after ${geminiMs}ms: ${error}`)
        this.setStatus("ERROR: Gemini failed - " + error)
        this.isRequestRunning = false
      })
  }

  private parseColorResponse(rawText: string) {
    print(`${LOG_TAG} Parsing color response...`)

    try {
      const parsed = JSON.parse(rawText)

      const hex: string = parsed.hex || "#000000"
      const r: number = parsed.r !== undefined ? parsed.r : 0
      const g: number = parsed.g !== undefined ? parsed.g : 0
      const b: number = parsed.b !== undefined ? parsed.b : 0
      const colorName: string = parsed.colorName || "unknown"

      print(`${LOG_TAG} Parsed color: hex=${hex}, rgb=(${r},${g},${b}), name=${colorName}`)

      const colorVec = new vec4(
        Math.max(0, Math.min(1, r / 255)),
        Math.max(0, Math.min(1, g / 255)),
        Math.max(0, Math.min(1, b / 255)),
        1
      )

      print(`${LOG_TAG} Color vec4: (${colorVec.r.toFixed(3)}, ${colorVec.g.toFixed(3)}, ${colorVec.b.toFixed(3)}, ${colorVec.a.toFixed(3)})`)

      this.applyColor(colorVec, hex, colorName)
    } catch (error) {
      print(`${LOG_TAG} ERROR: Failed to parse color response: ${error}`)
      print(`${LOG_TAG} Raw text was: ${rawText}`)
      this.setStatus("ERROR: Parse failed")
      this.isRequestRunning = false
    }
  }

  private applyColor(color: vec4, hex: string, colorName: string) {
    this.lastDetectedColor = color

    if (this.swatchMat) {
      this.swatchMat.mainPass.baseColor = color
      print(`${LOG_TAG} Debug swatch updated with color ${hex} (${colorName})`)
    }

    this.setStatus(`Color: ${hex} (${colorName})`)

    if (!this.hueEventEmitter) {
      print(`${LOG_TAG} HueEventEmitter not cached, searching scene...`)
      this.hueEventEmitter = this.findHueEventEmitterInScene()
    }

    if (this.hueEventEmitter) {
      try {
        this.hueEventEmitter.setColorUI(color)
        print(`${LOG_TAG} Sent color ${hex} to Hue lamp`)
      } catch (hueError) {
        print(`${LOG_TAG} ERROR: Failed to send color to Hue lamp: ${hueError}`)
      }
    } else {
      print(`${LOG_TAG} No HueEventEmitter found in scene (is a Hue light connected?)`)
    }

    this._onColorDetected.invoke(color)
    print(`${LOG_TAG} onColorDetected event fired with color ${hex}`)

    this.isRequestRunning = false
    const totalMs = ((getTime() - this.pipelineStartTime) * 1000).toFixed(0)
    print(`${LOG_TAG} --- Color pick cycle complete in ${totalMs}ms ---`)
  }

  private onUpdate() {
    if (!this.mainCamTrans || !this.swatchTrans) return

    const camPos = this.mainCamTrans.getWorldPosition()
    let desiredPos = camPos.add(this.mainCamTrans.forward.uniformScale(-CAM_DISTANCE))
    desiredPos = desiredPos.add(this.mainCamTrans.up.uniformScale(CAM_HEIGHT))

    this.swatchTrans.setWorldPosition(
      vec3.lerp(this.swatchTrans.getWorldPosition(), desiredPos, getDeltaTime() * 5)
    )

    const desiredRot = quat.lookAt(this.mainCamTrans.forward, vec3.up())
    this.swatchTrans.setWorldRotation(
      quat.slerp(this.swatchTrans.getWorldRotation(), desiredRot, getDeltaTime() * 5)
    )
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

  private setStatus(msg: string) {
    print(`${LOG_TAG} Status: ${msg}`)
    if (this.statusText) {
      this.statusText.text = msg
    }
  }
}
