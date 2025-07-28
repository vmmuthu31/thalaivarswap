#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function verifyTransaction() {
  const args = process.argv.slice(2);
  const txHash =
    args[0] ||
    "0x88ab777754e972b0e9df74bd7ab2b75828d08e59499a350a26892f2c7fcd4202"; // Latest transaction
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

  console.log("🔍 Verifying Polkadot transaction...");
  console.log(`📡 Network: ${wsUrl}`);
  console.log(`🆔 TX Hash: ${txHash}`);

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected to network");

    // Method 1: Try to get transaction by hash
    try {
      console.log("\n🔍 Method 1: Getting transaction by hash...");
      const tx = await api.rpc.author.hasKey(txHash, "sr25519");
      console.log(`   Result:`, tx.toJSON());
    } catch (error) {
      console.log(
        `   ❌ Method 1 failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Method 2: Try to get block containing the transaction
    try {
      console.log("\n🔍 Method 2: Searching recent blocks...");
      const currentBlock = await api.rpc.chain.getBlock();
      const currentBlockNumber = currentBlock.block.header.number.toNumber();
      console.log(`   Current block: ${currentBlockNumber}`);

      // Search last 10 blocks for our transaction
      for (let i = 0; i < 10; i++) {
        const blockNumber = currentBlockNumber - i;
        try {
          const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
          const block = await api.rpc.chain.getBlock(blockHash);

          // Check if our transaction is in this block
          const extrinsics = block.block.extrinsics;
          const found = extrinsics.find((ext) => ext.hash.toHex() === txHash);

          if (found) {
            console.log(`   ✅ Transaction found in block ${blockNumber}`);
            console.log(`   📦 Block hash: ${blockHash}`);
            console.log(
              `   🔗 Extrinsic: ${found.method.section}.${found.method.method}`
            );

            // Get events for this block to see if transaction succeeded
            const events = await api.query.system.events.at(blockHash);
            const eventsArray = events.toJSON() as Array<any>;
            console.log(`   📋 Events in block: ${eventsArray.length}`);

            // Look for ExtrinsicSuccess or ExtrinsicFailed events
            eventsArray.forEach((event: any, index: number) => {
              const {
                event: { data, method, section },
              } = event;
              if (
                section === "system" &&
                (method === "ExtrinsicSuccess" || method === "ExtrinsicFailed")
              ) {
                console.log(`   🎯 Event ${index}: ${section}.${method}`, data);
              }
            });

            await api.disconnect();
            return;
          }
        } catch (blockError) {
          console.log(
            `   ⚠️ Error checking block ${blockNumber}:`,
            blockError instanceof Error
              ? blockError.message
              : String(blockError)
          );
        }
      }

      console.log(`   ❌ Transaction not found in recent blocks`);
    } catch (error) {
      console.log(
        `   ❌ Method 2 failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Method 3: Check if the hash format is correct
    try {
      console.log("\n🔍 Method 3: Validating hash format...");
      console.log(`   Hash length: ${txHash.length} (should be 66)`);
      console.log(`   Starts with 0x: ${txHash.startsWith("0x")}`);

      if (txHash.length !== 66) {
        console.log(`   ❌ Invalid hash length`);
      } else if (!txHash.startsWith("0x")) {
        console.log(`   ❌ Hash should start with 0x`);
      } else {
        console.log(`   ✅ Hash format appears valid`);
      }
    } catch (error) {
      console.log(
        `   ❌ Method 3 failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Failed to verify transaction:", error);
  }
}

verifyTransaction();
