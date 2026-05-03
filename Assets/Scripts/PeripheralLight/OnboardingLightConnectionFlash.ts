import {HueLightData} from "../Core/PeripheralTypeData"
import {LensInitializer} from "../Core/LensInitializer"
import {reportError} from "../Helpers/ErrorUtils"

const LOG_TAG = "[HueOnboardingLightConnectionFlash]"

export class OnboardingLightConnectionFlash {
  static play(host: BaseScriptComponent, bluetoothGatt: Bluetooth.BluetoothGatt) {
    print(`${LOG_TAG} play requested`)

    if (global.deviceInfoSystem.isEditor() || LensInitializer.getInstance().isNoBleDebug) {
      print(`${LOG_TAG} skipped direct BLE flash in editor/no-BLE debug mode`)
      return
    }

    if (!host || !bluetoothGatt) {
      print(`${LOG_TAG} missing host or bluetoothGatt`)
      return
    }

    let brightnessCharacteristic: Bluetooth.BluetoothGattCharacteristic
    let colorCharacteristic: Bluetooth.BluetoothGattCharacteristic

    try {
      const baseService = bluetoothGatt.getService(HueLightData._baseServiceUUID)
      if (!baseService) {
        print(`${LOG_TAG} Hue base service not found`)
        return
      }

      brightnessCharacteristic = baseService.getCharacteristic(HueLightData._brightnessCharacteristicUUID)
      colorCharacteristic = baseService.getCharacteristic(HueLightData._colorCharacteristicUUID)
    } catch (error) {
      print(`${LOG_TAG} failed to read Hue service/characteristics: ${error}`)
      reportError(error)
      return
    }

    if (!brightnessCharacteristic || !colorCharacteristic) {
      print(`${LOG_TAG} missing brightness or color characteristic`)
      return
    }

    const finalColor = this.randomNeonColor()
    print(`${LOG_TAG} onboarding connection flash`)

    this.writeColor(colorCharacteristic, finalColor)
    this.writeBrightness(brightnessCharacteristic, 0.03)

    const flashUpEvent = host.createEvent("DelayedCallbackEvent")
    flashUpEvent.bind(() => {
      print(`${LOG_TAG} onboarding flash peak`)
      this.writeBrightness(brightnessCharacteristic, 1.0)
    })
    flashUpEvent.reset(0.6)

    const settleEvent = host.createEvent("DelayedCallbackEvent")
    settleEvent.bind(() => {
      print(`${LOG_TAG} onboarding flash settle`)
      this.writeColor(colorCharacteristic, finalColor)
      this.writeBrightness(brightnessCharacteristic, 0.45)
    })
    settleEvent.reset(1.35)
  }

  private static writeBrightness(
    brightnessCharacteristic: Bluetooth.BluetoothGattCharacteristic,
    brightness: number
  ) {
    const data = this.brightnessToHueByteArray(brightness)
    brightnessCharacteristic.writeValue(data).catch((error) => {
      print(`${LOG_TAG} brightness write failed: ${error}`)
      reportError(error)
    })
  }

  private static writeColor(colorCharacteristic: Bluetooth.BluetoothGattCharacteristic, color: vec4) {
    const colorXY = this.RGBtoXY(color.r, color.g, color.b)
    const data = this.xyToByteArray(colorXY.x, colorXY.y)
    colorCharacteristic.writeValue(data).catch((error) => {
      print(`${LOG_TAG} color write failed: ${error}`)
      reportError(error)
    })
  }

  private static randomNeonColor(): vec4 {
    const hue = Math.random()
    const sector = Math.floor(hue * 6)
    const frac = hue * 6 - sector
    const min = 0
    const desc = 1 - frac
    const asc = frac

    let r = 0
    let g = 0
    let b = 0

    switch (sector % 6) {
      case 0:
        r = 1
        g = asc
        b = min
        break
      case 1:
        r = desc
        g = 1
        b = min
        break
      case 2:
        r = min
        g = 1
        b = asc
        break
      case 3:
        r = min
        g = desc
        b = 1
        break
      case 4:
        r = asc
        g = min
        b = 1
        break
      case 5:
        r = 1
        g = min
        b = desc
        break
    }

    return new vec4(r, g, b, 1)
  }

  private static brightnessToHueByteArray(brightness: number): Uint8Array {
    brightness = Math.max(0, Math.min(1, brightness))

    // Lens Studio currently has trouble with first bytes > 127 for this BLE write,
    // so keep the same safe-byte range used by HueEventEmitter.
    const byte = Math.max(1, Math.min(127, Math.round(1 + brightness * 126)))
    return new Uint8Array([byte])
  }

  private static xyToByteArray(x: number, y: number): Uint8Array {
    const x16 = Math.round(x * 0xffff)
    const y16 = Math.round(y * 0xffff)
    const data = new Uint8Array(4)

    data[0] = x16 & 0xff
    data[1] = (x16 >> 8) & 0xff
    data[2] = y16 & 0xff
    data[3] = (y16 >> 8) & 0xff

    data[0] = Math.min(127, Math.max(1, data[0]))
    data[1] = Math.min(127, Math.max(1, data[1]))
    data[2] = Math.min(127, Math.max(1, data[2]))
    data[3] = Math.min(127, Math.max(1, data[3]))

    return data
  }

  private static RGBtoXY(r: number, g: number, b: number): vec2 {
    r = Math.max(0, Math.min(1, r))
    g = Math.max(0, Math.min(1, g))
    b = Math.max(0, Math.min(1, b))

    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92

    const X = r * 0.649926 + g * 0.103455 + b * 0.197109
    const Y = r * 0.234327 + g * 0.743075 + b * 0.022598
    const Z = g * 0.053077 + b * 1.035763

    let cx = X / (X + Y + Z)
    let cy = Y / (X + Y + Z)

    cx = Math.max(0.167, Math.min(0.675, cx))
    cy = Math.max(0.04, Math.min(0.518, cy))

    return new vec2(cx, cy)
  }
}
