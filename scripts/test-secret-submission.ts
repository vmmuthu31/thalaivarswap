#!/usr/bin/env ts-node

/**
 * Comprehensive Test for Secret Submission
 */

import { ethers } from "ethers";
import { DirectFusionAPI } from "../lib/direct-fusion-api";
import dotenv from "dotenv";

dotenv.config();

async function testSecretSubmission() {
  console.log("🔐 Testing Secret Submission Workflow...");
  console.log("=".repeat(60));

  const apiKey = process.env.NEXT_PUBLIC_FUSION_API_KEY;
  console.log(
    `   API Key: ${apiKey ? apiKey.substring(0, 8) + "..." : "NOT FOUND"}`
  );

  if (!apiKey) {
    console.error("❌ No API key found in environment variables");
    return;
  }

  try {
    const directAPI = new DirectFusionAPI(apiKey);

    console.log("\n🔄 Testing API connection...");
    const connected = await directAPI.testConnection();
    console.log(
      `   Connection test: ${connected ? "✅ Success" : "❌ Failed"}`
    );

    // Get detailed connection status
    const status = await directAPI.getConnectionStatus();
    console.log(
      `   📊 Direct API: ${status.directAPI ? "✅" : "❌"} | SDK: ${
        status.sdk ? "✅" : "❌"
      }`
    );

    console.log("\n🔑 Testing secret submission...");

    // Generate test data
    const testSecret = ethers.hexlify(ethers.randomBytes(32));
    const testOrderHash = ethers.hexlify(ethers.randomBytes(32));

    console.log(`   Test secret: ${testSecret.substring(0, 10)}...`);
    console.log(`   Test order hash: ${testOrderHash.substring(0, 10)}...`);

    try {
      const result = await directAPI.submitSecret(testOrderHash, testSecret);
      console.log("✅ Secret submission test successful!");
      console.log("   Response:", result);
    } catch (submitError) {
      console.error("❌ Secret submission failed:", submitError);

      if (submitError instanceof Error) {
        if (submitError.message.includes("404")) {
          console.log(
            "💡 This might be expected - the test order doesn't exist"
          );
        } else if (
          submitError.message.includes("401") ||
          submitError.message.includes("403")
        ) {
          console.log("💡 Authentication issue - check API key permissions");
        } else if (submitError.message.includes("400")) {
          console.log(
            "💡 Bad request - this is expected for test data (order doesn't exist)"
          );
        }
      }
    }

    console.log("\n📋 Testing order submission structure...");

    // Test order structure (won't actually submit)
    const testOrder = {
      order: {
        salt: "42",
        makerAsset: "0x0000000000000000000000000000000000000001",
        takerAsset: "0x0000000000000000000000000000000000000001",
        maker: "0x27E3FfEe60f242A9296Aa4780989E4bE74d680de",
        receiver: "0x27E3FfEe60f242A9296Aa4780989E4bE74d680de",
        makingAmount: "100000000000000000000",
        takingAmount: "100000000000000000000",
        makerTraits: "0",
      },
      srcChainId: 1,
      signature: "test_signature",
      extension: "0x",
      quoteId: "test_quote",
      secretHashes: [testSecret],
    };

    console.log("   Test order structure prepared");
    console.log(`   Order maker: ${testOrder.order.maker}`);
    console.log(`   Source chain: ${testOrder.srcChainId}`);

    console.log("\n✅ Secret submission workflow test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

async function demonstrateWorkflow() {
  console.log("\n" + "=".repeat(60));
  console.log("📚 SECRET SUBMISSION WORKFLOW DEMONSTRATION");
  console.log("=".repeat(60));

  console.log(`
📋 Proper Secret Submission Steps:

1️⃣  Create Cross-Chain Order
   - Generate secret and hashlock
   - Submit order to 1inch Fusion+
   - Wait for order confirmation

2️⃣  Wait for Escrow Creation
   - Source chain escrow (e.g., Ethereum HTLC)
   - Destination chain escrow (e.g., Polkadot HTLC)
   - Both escrows must be confirmed

3️⃣  Wait for Finality Lock Period
   - Prevents front-running attacks
   - Ensures both chains have finalized
   - Check with: getReadyToAcceptSecretFills(orderHash)

4️⃣  Check System Readiness
   - Verify public actions can proceed
   - Check with: getReadyToExecutePublicActions()

5️⃣  Verify Secret Status
   - Check if secret already published
   - Check with: getPublishedSecrets(orderHash)

6️⃣  Submit Secret
   - POST to: /relayer/v1.0/submit/secret
   - Include: orderHash and secret
   - Authorization: Bearer <API_KEY>

7️⃣  Monitor Completion
   - Resolvers will complete withdrawals
   - Funds will be exchanged atomically
   - Check final status with: getOrderStatus(orderHash)

🔑 Key Points:
   - Keep secret secure until submission time
   - Don't submit if another resolver already did
   - Ensure proper API authentication
   - Handle network timeouts gracefully
   - Verify balance changes after completion
`);
}

if (require.main === module) {
  testSecretSubmission().then(() => {
    demonstrateWorkflow();
  });
}
