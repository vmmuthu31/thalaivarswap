#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function analyzeFailedTransaction() {
  const args = process.argv.slice(2);
  const txHash =
    args[0] ||
    "0x39ae6955a3372a50554a7bc8148fa86125322c4b347d092d9f90fe8964b4a29d";
  const blockHash =
    args[1] ||
    "0x01de0a34f3416873910b4422f144196e436602954861afbaba315d9873e04f22";
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

  console.log("🔍 Analyzing Failed Transaction");
  console.log("==============================");
  console.log(`📡 Network: ${wsUrl}`);
  console.log(`🆔 TX Hash: ${txHash}`);
  console.log(`🧊 Block Hash: ${blockHash}`);
  console.log("");

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected to network");

    // Get the block with the failed transaction
    const block = await api.rpc.chain.getBlock(blockHash);
    console.log(`📦 Block number: ${block.block.header.number.toString()}`);

    // Find our transaction
    let foundExtrinsic: any = null;
    let extrinsicIndex = -1;

    block.block.extrinsics.forEach((extrinsic, index) => {
      const hash = extrinsic.hash.toHex();
      if (hash === txHash) {
        foundExtrinsic = extrinsic;
        extrinsicIndex = index;
        console.log(`🎯 Found transaction at extrinsic index ${index}`);
      }
    });

    if (!foundExtrinsic) {
      console.log("❌ Transaction not found in block");
      return;
    }

    // Analyze the extrinsic
    console.log("\n📝 Extrinsic Analysis:");
    console.log(`   Section: ${foundExtrinsic.method.section}`);
    console.log(`   Method: ${foundExtrinsic.method.method}`);
    console.log(`   Args: ${foundExtrinsic.method.args.toString()}`);

    // Get events for this block to understand why it failed
    console.log("\n📋 Block Events Analysis:");
    const events = await api.query.system.events.at(blockHash);

    let failureReason = "Unknown";
    let relatedEvents: any[] = [];

    events.forEach((record, index) => {
      const { event, phase } = record;

      // Check if this event is related to our extrinsic
      if (
        phase.isApplyExtrinsic &&
        phase.asApplyExtrinsic.toNumber() === extrinsicIndex
      ) {
        relatedEvents.push({
          index,
          section: event.section,
          method: event.method,
          data: event.data.toString(),
        });

        console.log(
          `   Event ${index} (Extrinsic ${extrinsicIndex}): ${event.section}.${event.method}`
        );

        if (event.section === "system" && event.method === "ExtrinsicFailed") {
          // Extract failure reason
          const failureData = event.data.toJSON() as any;
          console.log(
            `      ❌ Failure data: ${JSON.stringify(failureData, null, 6)}`
          );

          if (failureData && typeof failureData === "object") {
            if (failureData.module) {
              failureReason = `Module: ${failureData.module.index}, Error: ${failureData.module.error}`;
            } else if (failureData.Module) {
              failureReason = `Module: ${failureData.Module.index}, Error: ${failureData.Module.error}`;
            } else {
              failureReason = JSON.stringify(failureData);
            }
          }
        }
      }
    });

    console.log(`\n💥 Failure Reason: ${failureReason}`);

    // Try to decode the error if it's a module error
    if (failureReason.includes("Module:")) {
      console.log("\n🔍 Attempting to decode module error:");
      try {
        // Parse module index and error index
        const moduleMatch = failureReason.match(/Module: (\d+), Error: (\d+)/);
        if (moduleMatch) {
          const moduleIndex = parseInt(moduleMatch[1]);
          const errorIndex = parseInt(moduleMatch[2]);

          console.log(`   Module Index: ${moduleIndex}`);
          console.log(`   Error Index: ${errorIndex}`);

          // Get module metadata
          const metadata = api.registry.metadata;
          const modules = metadata.asLatest.pallets;

          if (modules && modules[moduleIndex]) {
            const module = modules[moduleIndex];
            console.log(`   Module Name: ${module.name.toString()}`);

            if (module.errors && module.errors.isSome) {
              const errors = module.errors.unwrap();
              if (errors[errorIndex]) {
                const errorInfo = errors[errorIndex];
                console.log(`   Error Name: ${errorInfo.name.toString()}`);
                console.log(
                  `   Error Docs: ${errorInfo.docs
                    .map((d) => d.toString())
                    .join(" ")}`
                );
              }
            }
          }
        }
      } catch (error) {
        console.log(`   ⚠️  Could not decode error: ${error}`);
      }
    }

    // Analyze revive pallet specific issues
    console.log("\n🔧 Revive Pallet Analysis:");

    // Check if the contract exists
    try {
      const contractAddress = "0xc12c83c055b8250c3d50984ce21bf27dfec8896a";
      console.log(`   Checking contract: ${contractAddress}`);

      if (api.query.revive?.contractInfoOf) {
        const contractInfo = await api.query.revive.contractInfoOf(
          contractAddress
        );
        console.log(
          `   Contract exists: ${contractInfo && !contractInfo.isEmpty}`
        );
        if (contractInfo && !contractInfo.isEmpty) {
          console.log(`   Contract info: ${contractInfo.toString()}`);
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not check contract info: ${error}`);
    }

    // Check account balance
    try {
      const senderAddress = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      const account = await api.query.system.account(senderAddress);
      const accountData = account.toJSON() as any;
      console.log(
        `   Sender balance: ${accountData.data.free} (${(
          parseInt(accountData.data.free) / 1e12
        ).toFixed(6)} DOT)`
      );
    } catch (error) {
      console.log(`   ⚠️  Could not check sender balance: ${error}`);
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Analysis failed:", error);
  }
}

analyzeFailedTransaction().catch(console.error);
