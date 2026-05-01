@component
export class GeminiDirectClient extends BaseScriptComponent {
  @input
  @hint("Gemini API key. Prefer a backend proxy instead for published lenses.")
  apiKey: string = ""

  @input
  @hint("Asset.InternetModule used for direct HTTPS requests.")
  internetModule: InternetModule

  async generateContent(model: string, body: any): Promise<any> {
    if (!this.internetModule) {
      throw new Error("GeminiDirectClient requires an InternetModule asset.")
    }

    if (!this.apiKey || this.apiKey.length === 0) {
      throw new Error("GeminiDirectClient requires a Gemini API key.")
    }

    const modelPath = model.indexOf("models/") === 0 ? model : "models/" + model
    const url = "https://generativelanguage.googleapis.com/v1beta/" + modelPath + ":generateContent"

    const response = await this.internetModule.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      let errorBody = ""
      try {
        errorBody = await response.text()
      } catch (error) {
        errorBody = "" + error
      }
      throw new Error("Gemini HTTP " + response.status + ": " + errorBody)
    }

    return await response.json()
  }
}
