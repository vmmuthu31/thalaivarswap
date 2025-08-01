#!/usr/bin/env tsx

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { AssetHubContractWrapper } from "../lib/asset-hub-contract";
import contractMetadata from "../lib/polkadotrelayer.json";

async function testContractCall() {
  console.log("🧪 Testing DOT contract call directly...");

  // Wait for WASM to be ready
  await cryptoWaitReady();

  // Connect to Polkadot node
  const wsProvider = new WsProvider(process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev");
  const api = await ApiPromise.create({ provider: wsProvider });

  console.log("✅ Connected to Polkadot node");

  // Setup account
  const keyring = new Keyring({ type: "sr25519" });
  const account = keyring.addFromUri(process.env.POLKADOT_SEED || "//Bob");

  console.log(`📝 Using account: ${account.address}`);

  // Check balance
  const accountInfo = await api.query.system.account(account.address);
  const balance = (accountInfo as any).data;
  console.log(`💰 Account balance: ${balance.free.toHuman()}`);

  // Create contract wrapper
  const contractAddress = process.env.POLKADOT_CONTRACT_ADDRESS || "";
  const contract = new AssetHubContractWrapper(api, contractAddress);

  console.log(`📄 Contract address: ${contractAddress}`);

  // Test parameters - use properly formatted 32-byte values
  const receiver = account.address; // Use Polkadot address instead of Ethereum address
  const hashlock = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"; // 32 bytes
  const swapId = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"; // 32 bytes
  
  // Create proper 32-byte test ID for contractExists
  const testContractId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const currentBlock = await api.query.system.number();
  const timelock = parseInt(currentBlock.toString()) + 150; // Keep reasonable timelock
  const sourceChain = 1000;
  const destChain = 1;
  const destAmount = api.createType('Balance', 1 * Math.pow(10, 12)).toString(); // 1 DOT in Planck (12 decimals for AZERO)

  console.log("\n📋 Test parameters:");
  console.log(`   Receiver: ${receiver}`);
  console.log(`   Hashlock: ${hashlock}`);
  console.log(`   Timelock: ${timelock}`);
  console.log(`   SwapId: ${swapId}`);
  console.log(`   SourceChain: ${sourceChain}`);
  console.log(`   DestChain: ${destChain}`);
  console.log(`   DestAmount: ${destAmount}`);

  try {
    // First test a simple read-only function
    console.log("\n🔍 Testing contract existence with contractExists...");
    const exists = await contract.contractExists(testContractId);
    console.log(`   Contract exists result: ${exists}`);

    console.log("\n🔄 Calling newContract...");
    const result = await contract.newContract(
      account,
      receiver,
      hashlock,
      timelock,
      swapId,
      sourceChain,
      destChain,
      destAmount
    );

    console.log("\n📊 Result:", result);

    if (result.success && 'txHash' in result) {
      console.log("✅ Contract call successful!");
      console.log(`   Transaction hash: ${result.txHash}`);
      if ('blockHash' in result) {
        console.log(`   Block hash: ${result.blockHash}`);
      }
    } else {
      console.log("❌ Contract call failed!");
      if ('error' in result) {
        console.log(`   Error: ${result.error}`);
      }
    }

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await api.disconnect();
    console.log("👋 Disconnected from Polkadot node");
  }
}

testContractCall().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});