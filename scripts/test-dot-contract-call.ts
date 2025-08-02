#!/usr/bin/env tsx

import * as dotenv from "dotenv";
dotenv.config();

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
  
  if (!contractAddress) {
    console.error("❌ POLKADOT_CONTRACT_ADDRESS not set in environment variables");
    console.log("Please set the contract address in your .env file");
    process.exit(1);
  }
  
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
    // Test all read-only functions
    console.log("\n🔍 Testing read-only functions...");
    
    // 1. Test contractExists
    console.log("\n1️⃣ Testing contractExists...");
    const exists = await contract.contractExists(testContractId, account.address);
    console.log(`   Contract exists result: ${exists}`);

    // 2. Test getContract (should return null for non-existent contract)
    console.log("\n2️⃣ Testing getContract...");
    const contractData = await contract.getContract(testContractId, account.address);
    console.log(`   Contract data:`, contractData);

    // 3. Test getSecret (should return null for non-existent contract)
    console.log("\n3️⃣ Testing getSecret...");
    const secret = await contract.getSecret(testContractId, account.address);
    console.log(`   Secret:`, secret);

    // 4. Test getCrossAddress
    console.log("\n4️⃣ Testing getCrossAddress...");
    const crossAddress = await contract.getCrossAddress(account.address, account.address);
    console.log(`   Cross address for ${account.address}:`, crossAddress);

    // 5. Test getAdmin
    console.log("\n5️⃣ Testing getAdmin...");
    const admin = await contract.getAdmin(account.address);
    console.log(`   Admin address:`, admin);

    // 6. Test getProtocolFeeBps
    console.log("\n6️⃣ Testing getProtocolFeeBps...");
    const feeBps = await contract.getProtocolFeeBps(account.address);
    console.log(`   Protocol fee BPS:`, feeBps);

    // 7. Test getProtocolFees
    console.log("\n7️⃣ Testing getProtocolFees...");
    const protocolFees = await contract.getProtocolFees(account.address);
    console.log(`   Protocol fees:`, protocolFees);

    // Now create a contract and test read functions again
    console.log("\n🔄 Creating a new contract to test read functions with real data...");
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

    console.log("\n📊 Contract creation result:", result);

    if (result.success && 'txHash' in result) {
      console.log("✅ Contract creation successful!");
      console.log(`   Transaction hash: ${result.txHash}`);
      if ('blockHash' in result) {
        console.log(`   Block hash: ${result.blockHash}`);
      }

      // Wait a moment for the transaction to be processed
      console.log("\n⏳ Waiting for transaction to be processed...");
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Test read functions again with the created contract
      console.log("\n🔍 Testing read functions with created contract...");
      
      console.log("\n8️⃣ Re-testing contractExists with created contract...");
      const existsAfterCreation = await contract.contractExists(swapId, account.address);
      console.log(`   Contract exists result: ${existsAfterCreation}`);

      console.log("\n9️⃣ Re-testing getContract with created contract...");
      const contractDataAfterCreation = await contract.getContract(swapId, account.address);
      console.log(`   Contract data:`, JSON.stringify(contractDataAfterCreation, null, 2));

      console.log("\n🔟 Re-testing getSecret with created contract...");
      const secretAfterCreation = await contract.getSecret(swapId, account.address);
      console.log(`   Secret:`, secretAfterCreation);

    } else {
      console.log("❌ Contract creation failed!");
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