#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import dotenv from "dotenv";
import contractMetadata from "../lib/polkadotrelayer.json";

// Load environment variables
dotenv.config();

const CONFIG = {
  POLKADOT_WS_URL: process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev",
  POLKADOT_SEED: process.env.POLKADOT_SEED || "//Alice",
  POLKADOT_CONTRACT_ADDRESS: process.env.POLKADOT_CONTRACT_ADDRESS || "",
};

async function checkDotContract() {
  console.log("🔍 Checking DOT Contract Status...\n");

  try {
    // Initialize crypto
    await cryptoWaitReady();

    // Create keyring and account
    const keyring = new Keyring({ type: "sr25519" });
    const account = keyring.addFromUri(CONFIG.POLKADOT_SEED);

    console.log("📋 Configuration:");
    console.log(`   Account: ${account.address}`);
    console.log(`   Network: ${CONFIG.POLKADOT_WS_URL}`);
    console.log(`   Contract: ${CONFIG.POLKADOT_CONTRACT_ADDRESS}\n`);

    // Connect to Polkadot
    console.log("🔗 Connecting to network...");
    const wsProvider = new WsProvider(CONFIG.POLKADOT_WS_URL);
    const api = await ApiPromise.create({ provider: wsProvider });

    const chain = await api.rpc.system.chain();
    console.log(`   Connected to: ${chain}\n`);

    // Check if contract address is valid
    if (!CONFIG.POLKADOT_CONTRACT_ADDRESS) {
      console.log("❌ No contract address configured!");
      console.log("   Please set POLKADOT_CONTRACT_ADDRESS in your .env file\n");
      return;
    }

    // Check contract code
    console.log("📄 Checking contract code...");
    try {
      const contractInfo = await api.query.contracts.contractInfoOf(CONFIG.POLKADOT_CONTRACT_ADDRESS);
      
      if (contractInfo && (contractInfo as any).isSome) {
        console.log("✅ Contract exists on chain!");
        const info = (contractInfo as any).unwrap();
        console.log(`   Contract info: ${JSON.stringify(info.toJSON(), null, 2)}\n`);
      } else {
        console.log("❌ Contract does not exist at this address!");
        console.log("   The contract may need to be deployed first\n");
        return;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log("⚠️  Could not check contract existence:", errorMsg);
    }

    // Try to create contract instance
    console.log("🔧 Creating contract instance...");
    try {
      const contract = new ContractPromise(api, contractMetadata, CONFIG.POLKADOT_CONTRACT_ADDRESS);
      console.log("✅ Contract instance created successfully!");
      console.log(`   Contract address: ${contract.address}\n`);

      // Test a simple query
      console.log("🧪 Testing contract query...");
      try {
        // Try to call a view function to test if contract is responsive
        const gasLimit = api.registry.createType('WeightV2', {
          refTime: api.registry.createType('Compact<u64>', 1_000_000),
          proofSize: api.registry.createType('Compact<u64>', 10_000),
        });

        const { result, output } = await contract.query.getProtocolFeeBps(
          account.address,
          {
            gasLimit: gasLimit as any,
            storageDepositLimit: null,
          }
        );

        if (result.isOk) {
          console.log("✅ Contract query successful!");
          console.log(`   Protocol fee: ${output?.toJSON()}\n`);
        } else {
          console.log("⚠️  Contract query failed:", result.asErr.toJSON());
        }
      } catch (queryError) {
        const errorMsg = queryError instanceof Error ? queryError.message : String(queryError);
        console.log("⚠️  Contract query error:", errorMsg);
      }

    } catch (contractError) {
      const errorMsg = contractError instanceof Error ? contractError.message : String(contractError);
      console.log("❌ Failed to create contract instance:", errorMsg);
    }

    // Check account balance for contract interactions
    console.log("💰 Checking account balance for contract calls...");
    const balance = await api.query.system.account(account.address);
    const balanceData = balance.toJSON() as any;
    const freeBalance = parseFloat(balanceData.data?.free || balanceData.free || "0") / 1e12;
    
    console.log(`   Free balance: ${freeBalance.toFixed(6)} tokens`);
    
    if (freeBalance < 0.01) {
      console.log("⚠️  Low balance - may not be sufficient for contract calls");
    } else {
      console.log("✅ Balance sufficient for contract interactions");
    }

    await api.disconnect();

  } catch (error) {
    console.error("❌ Error checking contract:", error);
    process.exit(1);
  }
}

// Run the script
checkDotContract().catch(console.error);