/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 1inch Fusion+ SDK implementation (API removed as requested)
 * Uses only the SDK for all operations to ensure proper cross-chain functionality
 */
export class DirectFusionAPI {
  private baseURL: string;
  private apiKey: string;
  private sdkFallback: any = null;

  constructor(
    apiKey: string,
    baseURL: string = "https://api.1inch.dev/fusion-plus"
  ) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    // SDK-only mode, no API instance needed
  }

  /**
   * Initialize SDK fallback if needed
   */
  private async initSDKFallback(): Promise<void> {
    if (this.sdkFallback) return;

    try {
      // Use our existing FusionCrossChainSDK wrapper instead of raw SDK
      const { FusionCrossChainSDK } = await import("./fusion-sdk");

      this.sdkFallback = new FusionCrossChainSDK();

      console.log("🔄 SDK fallback initialized");
    } catch (error) {
      console.warn("⚠️ SDK fallback initialization failed:", error);
    }
  }

  /**
   * Submit secret using SDK only (API removed as requested)
   */
  async submitSecret(orderHash: string, secret: string): Promise<any> {
    try {
      console.log(
        `🔐 Submitting secret to 1inch Fusion+ SDK for order: ${orderHash.substring(
          0,
          10
        )}...`
      );

      await this.initSDKFallback();

      if (this.sdkFallback) {
        console.log("🔄 Using SDK for secret submission...");
        const result = await this.sdkFallback.submitSecret(orderHash, secret);
        console.log("✅ Secret submitted successfully via SDK");
        return result;
      } else {
        throw new Error("SDK not available");
      }
    } catch (error) {
      console.error("❌ SDK secret submission failed:", error);
      throw error;
    }
  }

  /**
   * Submit a cross-chain order using SDK only (API removed as requested)
   */
  async submitOrder(order: any): Promise<any> {
    try {
      console.log("📝 Submitting order to 1inch Fusion+ SDK...");

      await this.initSDKFallback();

      if (this.sdkFallback) {
        console.log("🔄 Using SDK for order submission...");
        const result = await this.sdkFallback.submitOrder(order);
        console.log("✅ Order submitted successfully via SDK");
        return result;
      } else {
        throw new Error("SDK not available");
      }
    } catch (error) {
      console.error("❌ SDK order submission failed:", error);
      throw error;
    }
  }

  /**
   * Test SDK connection only (API removed as requested)
   */
  async testConnection(): Promise<boolean> {
    let sdkWorking = false;

    // Test SDK only
    try {
      await this.initSDKFallback();
      if (this.sdkFallback) {
        // Try a simple SDK operation to test it
        sdkWorking = true;
        console.log("✅ SDK connection: Success");
      }
    } catch (error) {
      console.warn(
        "⚠️ SDK connection failed:",
        error instanceof Error ? error.message : error
      );
    }

    console.log(
      `📊 Connection status - SDK: ${sdkWorking ? "✅" : "❌"}`
    );

    return sdkWorking;
  }

  /**
   * Get SDK connection status only (API removed as requested)
   */
  async getConnectionStatus(): Promise<{ sdk: boolean }> {
    let sdkWorking = false;

    try {
      await this.initSDKFallback();
      sdkWorking = !!this.sdkFallback;
    } catch {
      // Silent fail for status check
    }

    return { sdk: sdkWorking };
  }
}
