#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function comprehensiveVerify() {
  const args = process.argv.slice(2);
  const txHash =
    args[0] ||
    "0xb89c1403673a4715d74558785182de603c2a8c78f8edda8d02c8c5701b897dda";
  const blockHash =
    args[1] ||
    "0x24253aa2a7cc6f089a8e2d593f6fde2160899330b6b378e0737825549b454fa9";
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

  console.log("🔍 Comprehensive Transaction Verification");
  console.log("==========================================");
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

    console.log("\n🔍 Block Verification:");
    console.log("----------------------");

    try {
      // Get the block
      const block = await api.rpc.chain.getBlock(blockHash);
      console.log(`✅ Block found!`);
      console.log(`   Block number: ${block.block.header.number.toString()}`);
      console.log(`   Parent hash: ${block.block.header.parentHash.toHex()}`);
      console.log(`   State root: ${block.block.header.stateRoot.toHex()}`);
      console.log(`   Extrinsics count: ${block.block.extrinsics.length}`);

      // Get block events for this block
      console.log("\n🔍 Block Events:");
      try {
        const blockEvents = await api.query.system.events.at(blockHash);
        console.log(`   Events count: ${blockEvents.length}`);

        // Show events related to our transaction
        let foundTxEvents = false;
        blockEvents.forEach((record, index) => {
          const { event, phase } = record;
          if (phase.isApplyExtrinsic) {
            const extrinsicIndex = phase.asApplyExtrinsic.toNumber();
            if (extrinsicIndex === 2) {
              // Our transaction is extrinsic 2
              foundTxEvents = true;
              console.log(
                `   Event ${index} (Extrinsic ${extrinsicIndex}): ${event.section}.${event.method}`
              );
              if (
                event.section === "system" &&
                event.method === "ExtrinsicFailed"
              ) {
                console.log(
                  `      ❌ Extrinsic failed: ${event.data.toString()}`
                );
              }
            }
          }
        });

        if (!foundTxEvents) {
          console.log(`   ⚠️  No events found for extrinsic 2`);
        }
      } catch (error) {
        console.log(`   ❌ Failed to get block events: ${error}`);
      }

      console.log("\n🔍 Transaction Verification:");
      console.log("----------------------------");

      // Check each extrinsic
      let foundTransaction = false;
      block.block.extrinsics.forEach((extrinsic, index) => {
        const extrinsicHash = extrinsic.hash.toHex();
        console.log(`   Extrinsic ${index}: ${extrinsicHash}`);

        if (extrinsicHash === txHash) {
          foundTransaction = true;
          console.log(`   🎯 FOUND TARGET TRANSACTION!`);
          console.log(
            `      Method: ${extrinsic.method.section}.${extrinsic.method.method}`
          );
          console.log(
            `      Signer: ${extrinsic.signer?.toString() || "None"}`
          );
          console.log(`      Args: ${extrinsic.method.args.toString()}`);
        }
      });

      if (foundTransaction) {
        console.log(`\n✅ VERIFICATION SUCCESSFUL!`);
        console.log(
          `   The transaction ${txHash} is confirmed in block ${block.block.header.number.toString()}`
        );
      } else {
        console.log(`\n❌ Transaction not found in specified block`);
      }
    } catch (error) {
      console.log(`❌ Failed to get block: ${error}`);
    }

    // Try alternative explorer URLs
    console.log("\n🔗 Alternative Explorer Options:");
    console.log("--------------------------------");
    console.log(
      `1. Polkadot.js Apps (Block): https://polkadot.js.org/apps/?rpc=${encodeURIComponent(
        wsUrl
      )}#/explorer/query/${blockHash}`
    );
    console.log(
      `2. Polkadot.js Apps (TX): https://polkadot.js.org/apps/?rpc=${encodeURIComponent(
        wsUrl
      )}#/explorer/query/${txHash}`
    );
    console.log(
      `3. Direct RPC Explorer: https://polkadot.js.org/apps/?rpc=${encodeURIComponent(
        wsUrl
      )}#/explorer`
    );

    // Test direct RPC calls
    console.log("\n🔍 Testing Direct RPC Calls:");
    console.log("-----------------------------");

    try {
      // Test if we can get block header
      const header = await api.rpc.chain.getHeader(blockHash);
      console.log(`✅ Block header accessible via RPC`);
      console.log(`   Number: ${header.number.toString()}`);
    } catch (error) {
      console.log(`❌ Block header not accessible: ${error}`);
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Connection failed:", error);
  }
}

comprehensiveVerify().catch(console.error);
