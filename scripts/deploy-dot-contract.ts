#!/usr/bin/env tsx

import { ApiPromise, WsProvider } from "@polkadot/api";
import { CodePromise, ContractPromise } from "@polkadot/api-contract";
import { Keyring } from "@polkadot/keyring";
import { KeyringPair } from "@polkadot/keyring/types";
import { ISubmittableResult } from "@polkadot/types/types";
import * as fs from "fs";
import * as path from "path";

// Load contract metadata and wasm
const contractPath = path.join(__dirname, "../polkadotrelayer/target/ink/polkadotrelayer.contract");
const contractData = JSON.parse(fs.readFileSync(contractPath, "utf8"));

async function deployContract() {
  console.log("🚀 Starting Polkadot contract deployment...");

  // Connect to Polkadot node
  const wsProvider = new WsProvider(process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev");
  const api = await ApiPromise.create({ provider: wsProvider });

  console.log("✅ Connected to Polkadot node");

  // Setup account
  const keyring = new Keyring({ type: "sr25519" });
  const account: KeyringPair = keyring.addFromUri(process.env.POLKADOT_SEED || "//Alice");

  console.log(`📝 Deploying from account: ${account.address}`);

  // Check account balance
  const accountInfo = await api.query.system.account(account.address);
  const balance = (accountInfo as any).data;
  console.log(`💰 Account balance: ${balance.free.toHuman()}`);

  try {
    // Create code promise from contract data
    const code = new CodePromise(api, contractData, contractData.source.wasm);

    console.log("📦 Contract code loaded, starting deployment...");

    // First, let's do a dry run to estimate gas
    console.log("🧪 Performing dry run to estimate gas...");
    
    try {
      const dryRun = await api.call.contractsApi.instantiate(
        account.address,
        0, // value
        null, // gasLimit (null for estimation)
        null, // storageDepositLimit
        contractData.source.hash,
        "0x9bae9d5e", // constructor selector for "new"
        "0x" // constructor args (empty for new())
      );
      
      console.log("Dry run result:", dryRun.toHuman());
    } catch (error) {
      console.log("Dry run failed, proceeding with manual gas limits:", error);
    }

    // Deploy the contract with very conservative gas limits for Aleph Zero
    const tx = code.tx.new({
      gasLimit: api.registry.createType('WeightV2', {
        refTime: api.registry.createType('Compact<u64>', 1_000_000), // Very low gas for Aleph Zero
        proofSize: api.registry.createType('Compact<u64>', 1_000),   // Very low proof size
      }) as any,
      storageDepositLimit: null,
      value: 0, // No value needed for constructor
    });

    console.log("⏳ Submitting deployment transaction...");

    const result = await new Promise<{
      contract?: ContractPromise;
      address?: string;
      error?: string;
    }>((resolve) => {
      tx.signAndSend(account, (result: ISubmittableResult) => {
        console.log(`   Transaction status: ${result.status.type}`);

        if (result.status.isInBlock) {
          console.log(`   📦 Transaction included in block: ${result.status.asInBlock.toHex()}`);
        }

        if (result.status.isFinalized) {
          console.log(`   ✅ Transaction finalized in block: ${result.status.asFinalized.toHex()}`);

          // Find the contract instantiated event
          const contractEvent = result.events.find(({ event }) =>
            api.events.contracts.Instantiated.is(event)
          );

          if (contractEvent) {
            const contractAddress = contractEvent.event.data[1].toString();
            console.log(`   🎉 Contract deployed at address: ${contractAddress}`);

            const contract = new ContractPromise(api, contractData, contractAddress);
            resolve({ contract, address: contractAddress });
          } else {
            console.error("   ❌ Contract instantiation event not found");
            resolve({ error: "Contract instantiation event not found" });
          }
        }

        if (result.isError) {
          console.error("   ❌ Transaction failed");
          resolve({ error: "Transaction failed" });
        }
      }).catch((error) => {
        console.error("   ❌ Transaction submission failed:", error);
        resolve({ error: error.message });
      });
    });

    if (result.error) {
      console.error("❌ Deployment failed:", result.error);
      process.exit(1);
    }

    if (result.address) {
      console.log("\n🎉 Contract deployment successful!");
      console.log(`📍 Contract Address: ${result.address}`);
      console.log("\n📝 Update your .env file with the new contract address:");
      console.log(`POLKADOT_CONTRACT_ADDRESS=${result.address}`);
      
      // Test the deployed contract
      console.log("\n🧪 Testing deployed contract...");
      const contract = result.contract!;
      
      // Test a simple query to verify the contract is working
      try {
        const { result: queryResult } = await contract.query.contractExists(
          account.address,
          {
            gasLimit: api.registry.createType('WeightV2', {
              refTime: api.registry.createType('Compact<u64>', 10_000_000),
              proofSize: api.registry.createType('Compact<u64>', 10_000),
            }) as any,
            storageDepositLimit: null,
          },
          "test_contract_id"
        );

        if (queryResult.isOk) {
          console.log("✅ Contract is responding to queries correctly");
        } else {
          console.log("⚠️  Contract query returned error (this might be expected for non-existent contract)");
        }
      } catch (error) {
        console.log("⚠️  Contract query test failed:", error);
      }
    }

  } catch (error) {
    console.error("❌ Deployment error:", error);
    process.exit(1);
  } finally {
    await api.disconnect();
    console.log("👋 Disconnected from Polkadot node");
  }
}

// Run deployment
deployContract().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});