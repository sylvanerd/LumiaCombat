/**
 * v1.0
 *
 */

import {reportError} from "../Helpers/ErrorUtils"
import {Logger} from "../Helpers/Logger"
// import {ClimateController} from "../PeripheralClimate/ClimateController"
// import {HeartRateController} from "../PeripheralHeartRate/HeartRateController"
import {LightController} from "../PeripheralLight/LightController"
import {LensInitializer} from "./LensInitializer"
import {HueLightData} from "./PeripheralTypeData"
// import {HeartRateMonitorData, Thingy52Data} from "./PeripheralTypeData"
import {ScanResultType} from "./ScanResult"
import {Widget} from "./Widget"

@component
export class ControllerFactory extends BaseScriptComponent {
  @input
  pfbWidget: ObjectPrefab

  @input
  pfbLightController: ObjectPrefab

  // @input
  // pfbHeartRateMonitorController: ObjectPrefab

  // @input
  // pfbClimateController: ObjectPrefab

  @input
  node: SceneObject

  private localPositionOffset = new vec3(0, 0, 0.5)
  private localScaleMult = 0.75

  private instantiateControllerContent(bluetoothGatt: Bluetooth.BluetoothGatt) {
    Logger.getInstance().log("controllerfactory instantiateControllerContent " + bluetoothGatt)
    if (!global.deviceInfoSystem.isEditor() && !LensInitializer.getInstance().isNoBleDebug) {
      const gatt: Bluetooth.BluetoothGatt = bluetoothGatt as Bluetooth.BluetoothGatt

      // try {
      //   const heartRateService = gatt.getService(HeartRateMonitorData._serviceUUIDHR)
      //   if (heartRateService) {
      //     Logger.getInstance().log("Controllerfactory instantiateControllerContent hrm " + heartRateService)
      //     return this.onFoundHRM(bluetoothGatt)
      //   }
      // } catch (error) {
      //   reportError(error)
      // }

      // try {
      //   const climateService = gatt.getService(Thingy52Data._weatherServiceUUID)
      //   if (climateService) {
      //     Logger.getInstance().log("Controllerfactory instantiateControllerContent climate " + climateService)
      //     return this.onFoundClimate(bluetoothGatt)
      //   }
      // } catch (error) {
      //   reportError(error)
      // }

      try {
        const hueLightService = gatt.getService(HueLightData._baseServiceUUID)
        if (hueLightService) {
          Logger.getInstance().log("Controllerfactory instantiateControllerContent getService light " + hueLightService)
          return this.onFoundLight(bluetoothGatt)
        }
      } catch (error) {
        reportError(error)

        // This is our last stop to return undefined, which signals that we don't have a controller for this connection
        // NOTE: If you add more trycatch's, you need to put this in your last catch
        Logger.getInstance().log("Controllerfactory instantiateControllerContent can't find controller")
        return undefined
      }
    } else {
      // To debug ui in editor, this will spawn the ui, but it won't be functional
      // Select a random controller to test them all in editor
      const randomNumber = Math.random()
      Logger.getInstance().log("controllerfactory instantiateControllerContent debug " + randomNumber)

      if (randomNumber < 0.75) {
        return this.onFoundLight(undefined)
      // } else if (randomNumber < 0.5) {
      //   return this.onFoundHRM(undefined)
      // } else if (randomNumber < 0.75) {
      //   return this.onFoundClimate(undefined)
      } else {
        return undefined
      }
    }
  }

  private onFoundLight(bluetoothGatt: Bluetooth.BluetoothGatt) {
    const widget = this.instantiateWidget()
    widget.init(this.node, ScanResultType.Light)

    const so = this.instantiateControllerContentHelper(this.pfbLightController, widget.getSceneObject())
    so.getTransform().setLocalScale(vec3.one().uniformScale(this.localScaleMult))

    // The pfbLight root has many ScriptComponents on it. so.getComponent("ScriptComponent")
    // returns only the FIRST one, which is not guaranteed to be LightController -- the
    // "as LightController" cast is a no-op at runtime, so calling .init() on the wrong
    // script silently does nothing. Iterate all ScriptComponents and find the LightController
    // by checking for the init signature explicitly.
    const allScripts = so.getComponents("Component.ScriptComponent") as ScriptComponent[]
    Logger.getInstance().log(
      "HueControllerFactory onFoundLight prefab instantiated, scriptComponents on root: " + allScripts.length
    )

    let newLightController: LightController | undefined = undefined
    for (let i = 0; i < allScripts.length; i++) {
      const s = allScripts[i] as any
      // LightController owns the color-wheel query methods and the BLE/UI init path.
      if (s && typeof s.init === "function" && typeof s.getWorldColorAtScreenPos === "function") {
        newLightController = s as LightController
        Logger.getInstance().log("HueControllerFactory onFoundLight matched LightController at index " + i)
        break
      }
    }

    if (newLightController) {
      Logger.getInstance().log("HueControllerFactory onFoundLight calling LightController.init")
      newLightController.init(bluetoothGatt, widget)
    } else {
      Logger.getInstance().log("HueControllerFactory onFoundLight ERROR: no LightController found on instantiated pfbLight")
    }
    return widget
  }

  // private onFoundHRM(bluetoothGatt: Bluetooth.BluetoothGatt) {
  //   const widget = this.instantiateWidget()
  //   widget.init(this.node, ScanResultType.Hrm)
  //
  //   const so = this.instantiateControllerContentHelper(this.pfbHeartRateMonitorController, widget.getSceneObject())
  //   const newHeartRateController = so.getComponent("ScriptComponent") as HeartRateController
  //   if (newHeartRateController) {
  //     newHeartRateController.init(bluetoothGatt)
  //   }
  //   return widget
  // }
  //
  // private onFoundClimate(bluetoothGatt: Bluetooth.BluetoothGatt) {
  //   const widget = this.instantiateWidget()
  //   widget.init(this.node, ScanResultType.Climate)
  //
  //   const so = this.instantiateControllerContentHelper(this.pfbClimateController, widget.getSceneObject())
  //   const newClimateController = so.getComponent("ScriptComponent") as ClimateController
  //   if (newClimateController) {
  //     newClimateController.init(bluetoothGatt)
  //   }
  //   return widget
  // }

  private instantiateControllerContentHelper(pfb: ObjectPrefab, uiSo: SceneObject) {
    const so = pfb.instantiate(uiSo)
    const tr = so.getTransform()
    tr.setLocalPosition(this.localPositionOffset)
    tr.setLocalRotation(quat.quatIdentity())
    tr.setLocalScale(vec3.one())
    return so
  }

  private instantiateWidget() {
    const so = this.pfbWidget.instantiate(null)
    const tr = so.getTransform()
    tr.setWorldPosition(this.node.getTransform().getWorldPosition())
    tr.setWorldRotation(this.node.getTransform().getWorldRotation())

    const widget = so.getComponent("ScriptComponent") as Widget
    return widget
  }

  create(bluetoothGatt: Bluetooth.BluetoothGatt) {
    // Returning the controllerUi instance means we found the controller for a service on the device
    // Returning undefined means we did not find a controller for a service on this device
    return this.instantiateControllerContent(bluetoothGatt)
  }
}
