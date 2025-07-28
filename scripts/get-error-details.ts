#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function getErrorDetails() {
  const args = process.argv.slice(2);
  const txHash =
    args[0] ||
    "0x94034ca921d6cb33d95686ebf71defcb7fdc9b902eddb210eeeec6e548c51ab5";
  const blockHash =
    args[1] ||
    "0x5ebee43e6c1f40b3688bb051afcfb1b13cb797bf54b849e78dd67965c88e0f5e";
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

  console.log("🔍 Getting Error Details");
  console.log("========================");
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

    // Get the events at this block height
    const blockNumber = await api.rpc.chain.getHeader(blockHash);
    console.log(`📦 Block number: ${blockNumber.number.toString()}`);

    // Get all events at this block
    const apiAt = await api.at(blockHash);
    const events = await apiAt.query.system.events();

    console.log(`📋 Found ${events.length} events in block`);

    // Look for ExtrinsicFailed events
    events.forEach((record: any, index: number) => {
      const { event } = record;

      if (event.section === "system" && event.method === "ExtrinsicFailed") {
        console.log(`\n❌ ExtrinsicFailed Event #${index}:`);
        console.log(`   Section: ${event.section}`);
        console.log(`   Method: ${event.method}`);
        console.log(`   Data: ${JSON.stringify(event.data, null, 2)}`);

        // Try to decode the error
        if (event.data && event.data[0]) {
          const dispatchError = event.data[0];
          console.log(
            `   Error Type: ${dispatchError.type || dispatchError.toString()}`
          );

          if (dispatchError.isModule) {
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            console.log(`   Module Error: ${decoded.section}.${decoded.name}`);
            console.log(`   Documentation: ${decoded.docs.join(" ")}`);
          } else {
            console.log(`   Error Details: ${dispatchError.toString()}`);
          }
        }
      }

      // Show transaction payment events too
      if (
        event.section === "transactionPayment" &&
        event.method === "TransactionFeePaid"
      ) {
        console.log(`\n💰 Transaction Fee: ${event.data.toString()}`);
      }

      // Show revive-related events
      if (event.section === "revive") {
        console.log(`\n🔄 Revive Event: ${event.section}.${event.method}`);
        console.log(`   Data: ${event.data.toString()}`);
      }
    });

    await api.disconnect();
    console.log("\n✅ Analysis complete");
  } catch (error) {
    console.error("❌ Error analyzing transaction:", error);
    process.exit(1);
  }
}

getErrorDetails().catch(console.error);
