#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function verifyBlock() {
  const args = process.argv.slice(2);
  const blockHash =
    args[0] ||
    "0x24253aa2a7cc6f089a8e2d593f6fde2160899330b6b378e0737825549b454fa9";
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

  console.log("🔍 Verifying Polkadot block...");
  console.log(`📡 Network: ${wsUrl}`);
  console.log(`🧊 Block Hash: ${blockHash}`);

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected to network");

    // Try to get the block
    console.log("\n🔍 Method 1: Getting block by hash...");
    try {
      const block = await api.rpc.chain.getBlock(blockHash);
      console.log(`   ✅ Block found!`);
      console.log(
        `   📊 Block number: ${block.block.header.number.toString()}`
      );
      console.log(`   📦 Extrinsics count: ${block.block.extrinsics.length}`);

      // Look for our transaction
      const targetTxHash =
        "0xb89c1403673a4715d74558785182de603c2a8c78f8edda8d02c8c5701b897dda";
      console.log(`\n🔍 Looking for transaction: ${targetTxHash}`);

      block.block.extrinsics.forEach((extrinsic, index) => {
        const extrinsicHash = extrinsic.hash.toHex();
        console.log(`   📝 Extrinsic ${index}: ${extrinsicHash}`);
        if (extrinsicHash === targetTxHash) {
          console.log(`   🎯 FOUND TARGET TRANSACTION!`);
        }
      });
    } catch (error) {
      console.log(`   ❌ Method 1 failed: ${error}`);
    }

    // Get current block for reference
    console.log("\n🔍 Getting current block for comparison...");
    try {
      const currentBlock = await api.rpc.chain.getHeader();
      console.log(`   📊 Current block: ${currentBlock.number.toString()}`);
    } catch (error) {
      console.log(`   ❌ Failed to get current block: ${error}`);
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Connection failed:", error);
  }
}

verifyBlock().catch(console.error);
