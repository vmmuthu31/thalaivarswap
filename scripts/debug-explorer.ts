#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function debugExplorerIssue() {
  const args = process.argv.slice(2);
  const txHash =
    args[0] ||
    "0xb89c1403673a4715d74558785182de603c2a8c78f8edda8d02c8c5701b897dda";
  const blockHash =
    args[1] ||
    "0x24253aa2a7cc6f089a8e2d593f6fde2160899330b6b378e0737825549b454fa9";
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

  console.log("🔍 Explorer Issue Debugging");
  console.log("===========================");
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

    // Get network info
    const [chain, nodeName, nodeVersion] = await Promise.all([
      api.rpc.system.chain(),
      api.rpc.system.name(),
      api.rpc.system.version(),
    ]);
    console.log(`   Chain: ${chain}`);
    console.log(`   Node: ${nodeName} ${nodeVersion}`);

    // Get current block for context
    const currentHeader = await api.rpc.chain.getHeader();
    console.log(`   Current block: ${currentHeader.number.toString()}`);

    console.log("\n🔍 Testing Explorer Accessibility:");
    console.log("----------------------------------");

    // Test 1: Can we get the block?
    try {
      const block = await api.rpc.chain.getBlock(blockHash);
      console.log(`✅ Block accessible via RPC`);
      console.log(`   Block number: ${block.block.header.number.toString()}`);
      console.log(`   Extrinsics: ${block.block.extrinsics.length}`);

      // Verify our transaction is there
      let found = false;
      block.block.extrinsics.forEach((extrinsic, index) => {
        const hash = extrinsic.hash.toHex();
        if (hash === txHash) {
          found = true;
          console.log(`   🎯 Transaction found at index ${index}`);
        }
      });

      if (!found) {
        console.log(`   ❌ Transaction not found in block`);
      }
    } catch (error) {
      console.log(`❌ Block not accessible: ${error}`);
    }

    // Test 2: Can we get block header?
    try {
      const header = await api.rpc.chain.getHeader(blockHash);
      console.log(`✅ Block header accessible`);
      console.log(`   Number: ${header.number.toString()}`);
      console.log(`   Parent: ${header.parentHash.toHex()}`);
    } catch (error) {
      console.log(`❌ Block header not accessible: ${error}`);
    }

    // Test 3: Check if the block number approach works
    try {
      const blockNumber = 803237; // We know this is the block number
      const hashAtNumber = await api.rpc.chain.getBlockHash(blockNumber);
      console.log(
        `✅ Block hash at number ${blockNumber}: ${hashAtNumber.toHex()}`
      );

      if (hashAtNumber.toHex() === blockHash) {
        console.log(`   ✅ Block hash matches our target block`);
      } else {
        console.log(
          `   ⚠️  Block hash doesn't match (possible chain reorganization)`
        );
      }
    } catch (error) {
      console.log(`❌ Failed to get block by number: ${error}`);
    }

    console.log("\n🔗 Explorer URL Analysis:");
    console.log("-------------------------");

    const baseUrl = "https://polkadot.js.org/apps/";
    const rpcParam = `?rpc=${encodeURIComponent(wsUrl)}`;

    console.log(`Base URL: ${baseUrl}`);
    console.log(`RPC Parameter: ${rpcParam}`);
    console.log(`Block Hash: ${blockHash}`);
    console.log(`TX Hash: ${txHash}`);

    // Different URL formats to try
    const blockNumber = 803237; // Known block number
    const urls = [
      `${baseUrl}${rpcParam}#/explorer/query/${blockHash}`,
      `${baseUrl}${rpcParam}#/explorer/query/${txHash}`,
      `${baseUrl}${rpcParam}#/explorer/query/0x${blockHash.substring(2)}`,
      `${baseUrl}${rpcParam}#/explorer/query/0x${txHash.substring(2)}`,
      `${baseUrl}${rpcParam}#/explorer/query/${blockNumber}`, // Block number instead of hash
    ];

    console.log("\n🌐 URLs to try:");
    urls.forEach((url, index) => {
      console.log(`${index + 1}. ${url}`);
    });

    console.log("\n💡 Possible Issues & Solutions:");
    console.log("-------------------------------");
    console.log("1. Custom testnet compatibility:");
    console.log("   - The explorer might not fully support custom testnets");
    console.log("   - Try using block number instead of hash in URL");
    console.log("");
    console.log("2. Browser/Cache issues:");
    console.log("   - Clear browser cache and try again");
    console.log("   - Try in incognito/private mode");
    console.log("");
    console.log("3. Network timing:");
    console.log("   - The explorer UI might need time to sync");
    console.log("   - Try again in a few minutes");
    console.log("");
    console.log("4. Direct verification:");
    console.log("   - Use the Network > Explorer tab in Polkadot.js Apps");
    console.log("   - Search manually for block number 803237");

    await api.disconnect();
  } catch (error) {
    console.error("❌ Connection failed:", error);
  }
}

debugExplorerIssue().catch(console.error);
