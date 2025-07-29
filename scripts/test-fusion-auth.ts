#!/usr/bin/env ts-node

/**
 * Test 1inch Fusion+ API Authentication
 */

import { FusionCrossChainSDK } from "../lib/fusion-sdk";
import dotenv from "dotenv";

dotenv.config();

async function testFusionAuth() {
  console.log("🔑 Testing 1inch Fusion+ API Authentication...");

  const apiKey = process.env.NEXT_PUBLIC_FUSION_API_KEY;
  console.log(
    `   API Key: ${apiKey ? apiKey.substring(0, 8) + "..." : "NOT FOUND"}`
  );

  if (!apiKey) {
    console.error("❌ No API key found in environment variables");
    console.log("   Expected: NEXT_PUBLIC_FUSION_API_KEY");
    return;
  }

  try {
    const fusionSDK = new FusionCrossChainSDK(
      "https://api.1inch.dev/fusion-plus",
      apiKey
    );

    console.log("� Testing public actions readiness first...");
    try {
      const publicReady = await fusionSDK.isReadyForPublicActions();
      console.log(`✅ Public actions check successful:`, publicReady);
    } catch (publicError) {
      console.warn(
        "⚠️ Public actions check failed:",
        publicError instanceof Error ? publicError.message : publicError
      );
    }

    console.log("�📋 Attempting to get active orders...");
    try {
      const orders = await fusionSDK.getActiveOrders(1, 1);
      console.log(
        `✅ Authentication successful! Found ${
          orders.items?.length || 0
        } orders`
      );
    } catch (ordersError) {
      console.warn(
        "⚠️ Get orders failed (this might be expected):",
        ordersError instanceof Error ? ordersError.message : ordersError
      );
    }

    console.log("📝 Trying to create a test quote...");
    try {
      const quote = await fusionSDK.getSwapQuote({
        srcChainId: 1, // Ethereum
        dstChainId: 56, // BSC
        srcTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // ETH
        dstTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // BNB
        amount: "1000000000000000000", // 1 ETH
        walletAddress: "0x27E3FfEe60f242A9296Aa4780989E4bE74d680de",
      });
      console.log(`✅ Quote successful:`, quote);
    } catch (quoteError) {
      console.warn(
        "⚠️ Quote failed:",
        quoteError instanceof Error ? quoteError.message : quoteError
      );
    }
  } catch (error) {
    console.error("❌ Authentication failed:", error);

    if (error instanceof Error) {
      if (error.message.includes("Auth error")) {
        console.log("💡 Solutions:");
        console.log("   1. Get a valid API key from https://portal.1inch.dev/");
        console.log("   2. Make sure the key has the correct permissions");
        console.log("   3. Check if the key is properly set in .env file");
      }
    }
  }
}

if (require.main === module) {
  testFusionAuth();
}
