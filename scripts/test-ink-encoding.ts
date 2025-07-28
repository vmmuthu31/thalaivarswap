#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import dotenv from "dotenv";

dotenv.config();

async function testInkEncoding() {
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";
  const contractAddress = "0xc12c83c055b8250c3d50984ce21bf27dfec8896a";

  console.log("🧪 Testing ink! Contract Call Encoding");
  console.log("=======================================");

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected to network");

    // Get account
    const keyring = new Keyring({ type: "sr25519" });
    const account = keyring.addFromUri(process.env.POLKADOT_PRIVATE_KEY!);

    // Test parameters
    const receiver = "0x27E3FfEe60f242A9296Aa4780989E4bE74d680de";
    const hashlock =
      "0xd38b7b7305098a7e4c341a37b089e7bdb73429e79e765a6e03a00dbc8f2cb63c";
    const timelock = 803649;
    const swapId =
      "0x2f0330135f00aec48ff7e005fe2206839ee8e2c2639077ac7dbafd06df485f76";
    const sourceChain = 1000;
    const destChain = 1;
    const destAmount = "10000000000"; // 0.01 DOT in Planck (10^10)

    console.log(`🔧 Parameters:`);
    console.log(`   receiver: ${receiver}`);
    console.log(`   hashlock: ${hashlock}`);
    console.log(`   timelock: ${timelock}`);
    console.log(`   swapId: ${swapId}`);
    console.log(`   sourceChain: ${sourceChain}`);
    console.log(`   destChain: ${destChain}`);
    console.log(`   destAmount: ${destAmount}`);

    // Try to do a dry run first using revive.call
    const functionSelector = "0xbbd45d7d";

    // For ink! contracts, we need to use the proper encoding
    // Let's try a minimal call with just the function selector first
    const minimalCallData = functionSelector + "00".repeat(224); // 7 * 32 bytes = 224 bytes of zeros

    console.log(`\n🔍 Testing minimal call data: ${minimalCallData}`);

    try {
      // Try to simulate the call first
      const dryRunResult = await api.call.contractsApi.call(
        account.address,
        contractAddress,
        destAmount,
        null, // gas limit (let runtime estimate)
        null, // storage deposit limit
        minimalCallData
      );

      console.log(`📋 Dry run result:`, dryRunResult.toHuman());

      if (dryRunResult.result && (dryRunResult.result as any).Ok) {
        console.log("✅ Minimal call would succeed");
      } else {
        console.log("❌ Minimal call would fail");
        console.log("Error:", dryRunResult.result);
      }
    } catch (error) {
      console.log("❌ Dry run failed:", error);
    }

    await api.disconnect();
    console.log("\n✅ Test complete");
  } catch (error) {
    console.error("❌ Error testing encoding:", error);
    process.exit(1);
  }
}

testInkEncoding().catch(console.error);
