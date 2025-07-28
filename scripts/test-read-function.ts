#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import dotenv from "dotenv";

dotenv.config();

async function testReadFunction() {
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";
  const contractAddress = "0xc12c83c055b8250c3d50984ce21bf27dfec8896a";

  console.log("🧪 Testing Contract Read Function");
  console.log("=================================");

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected to network");

    // Get account (needed for calls)
    const keyring = new Keyring({ type: "sr25519" });
    const testSeed = "//Alice"; // Use a test seed
    const account = keyring.addFromUri(testSeed);

    // Test parameters
    const testContractId =
      "0x0000000000000000000000000000000000000000000000000000000000000001"; // Test contract ID

    console.log(`🔧 Testing get_contract function`);
    console.log(`   Contract address: ${contractAddress}`);
    console.log(`   Test contract ID: ${testContractId}`);

    // Function selector for get_contract: 0x4be1ea76
    const functionSelector = "0x4be1ea76";

    // Encode the contract_id parameter (32 bytes)
    const contractIdBytes = testContractId.substring(2).padStart(64, "0"); // Remove 0x and pad to 32 bytes
    const callData = functionSelector + contractIdBytes;

    console.log(`📝 Call data: ${callData}`);

    try {
      // Try to call the function using revive.call with no value transfer
      const tx = api.tx.revive.call(
        contractAddress,
        0, // no value transfer
        {
          refTime: "10000000000", // Lower gas limit for read
          proofSize: "100000",
        },
        null,
        callData
      );

      console.log("📡 Submitting read-only call...");

      let txHash: string = "";
      let completed = false;

      const unsubscribe = await tx.signAndSend(
        account,
        { nonce: -1 },
        (status: any) => {
          if (status.txHash && !txHash) {
            txHash = status.txHash.toHex();
            console.log(`   📝 TX Hash: ${txHash}`);
          }

          if (status.status.isInBlock) {
            console.log(
              `   ✅ Included in block: ${status.status.asInBlock.toHex()}`
            );

            // Check events
            status.events.forEach((event: any, index: number) => {
              const { section, method } = event.event;
              console.log(`   Event ${index}: ${section}.${method}`);

              if (section === "system" && method === "ExtrinsicSuccess") {
                console.log("   ✅ Read call succeeded!");
              } else if (section === "system" && method === "ExtrinsicFailed") {
                console.log("   ❌ Read call failed");
              }
            });

            if (!completed) {
              completed = true;
              unsubscribe();
            }
          }
        }
      );

      // Wait a bit for the transaction
      await new Promise((resolve) => setTimeout(resolve, 10000));
    } catch (error) {
      console.log("❌ Read call failed:", error);
    }

    await api.disconnect();
    console.log("\n✅ Test complete");
  } catch (error) {
    console.error("❌ Error testing read function:", error);
    process.exit(1);
  }
}

testReadFunction().catch(console.error);
