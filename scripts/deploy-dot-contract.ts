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
  const account: KeyringPair = keyring.addFromUri(process.env.POLKADOT_SEED || "//Bob");

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

    // Deploy the contract with appropriate gas limits for Aleph Zero
    const tx = code.tx.new({
      gasLimit: api.registry.createType('WeightV2', {
        refTime: api.registry.createType('Compact<u64>', 100_000_000_000), // Higher gas for deployment
        proofSize: api.registry.createType('Compact<u64>', 100_000_000),   // Higher proof size for deployment
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
      
      // Test the deployed contract comprehensively
      console.log("\n🧪 Testing deployed contract...");
      const contract = result.contract!;
      
      // Test 1: Basic query functions
      console.log("\n📊 Testing basic query functions...");
      try {
        const { result: adminResult } = await contract.query.getAdmin(
          account.address,
          {
            gasLimit: api.registry.createType('WeightV2', {
              refTime: api.registry.createType('Compact<u64>', 10_000_000),
              proofSize: api.registry.createType('Compact<u64>', 10_000),
            }) as any,
            storageDepositLimit: null,
          }
        );

        if (adminResult.isOk) {
          console.log("✅ getAdmin query works correctly");
          console.log(`   Admin address: ${JSON.stringify(adminResult.asOk.toJSON())}`);
        } else {
          console.log("❌ getAdmin query failed");
        }
      } catch (error) {
        console.log("❌ getAdmin query error:", error);
      }

      // Test 2: Protocol fee query
      try {
        const { result: feeResult } = await contract.query.getProtocolFeeBps(
          account.address,
          {
            gasLimit: api.registry.createType('WeightV2', {
              refTime: api.registry.createType('Compact<u64>', 10_000_000),
              proofSize: api.registry.createType('Compact<u64>', 10_000),
            }) as any,
            storageDepositLimit: null,
          }
        );

        if (feeResult.isOk) {
          console.log("✅ getProtocolFeeBps query works correctly");
          console.log(`   Protocol fee: ${feeResult.asOk.toJSON()} basis points`);
        } else {
          console.log("❌ getProtocolFeeBps query failed");
        }
      } catch (error) {
        console.log("❌ getProtocolFeeBps query error:", error);
      }

      // Test 3: Contract existence check
      try {
        const { result: existsResult } = await contract.query.contractExists(
          account.address,
          {
            gasLimit: api.registry.createType('WeightV2', {
              refTime: api.registry.createType('Compact<u64>', 10_000_000),
              proofSize: api.registry.createType('Compact<u64>', 10_000),
            }) as any,
            storageDepositLimit: null,
          },
          '0x' + '0'.repeat(64) // Dummy contract ID
        );

        if (existsResult.isOk) {
          console.log("✅ contractExists query works correctly");
          console.log(`   Non-existent contract check: ${existsResult.asOk.toJSON()}`);
        } else {
          console.log("❌ contractExists query failed");
        }
      } catch (error) {
        console.log("❌ contractExists query error:", error);
      }

      // Test 4: CRITICAL - Timelock validation test
      console.log("\n🔍 Testing timelock configuration (CRITICAL)...");
      const currentBlock = await api.query.system.number();
      const currentBlockNum = parseInt(currentBlock.toString());
      const testTimelock = currentBlockNum + 150; // Should be valid with default settings
      
      try {
        const { result: timelockResult } = await contract.query.newContract(
          account.address,
          {
            gasLimit: api.registry.createType('WeightV2', {
              refTime: api.registry.createType('Compact<u64>', 50_000_000_000),
              proofSize: api.registry.createType('Compact<u64>', 50_000_000),
            }) as any,
            storageDepositLimit: null,
            value: "100000000000", // 0.1 token
          },
          api.createType('AccountId', account.address).toHex(), // receiver
          '0x' + '1234567890abcdef'.repeat(4), // hashlock
          testTimelock, // timelock
          '0x' + Date.now().toString(16).padStart(64, '0'), // swapId
          1, // source_chain
          2, // dest_chain
          "100000000000", // dest_amount
          null, // sender_cross_address
          null  // receiver_cross_address
        );

        if (timelockResult.isOk) {
          const response = timelockResult.asOk.toJSON() as any;
          if (response?.ok?.err) {
            if (response.ok.err === "TimelockTooLong") {
              console.log("❌ CRITICAL ISSUE: Contract has max_timelock set too low!");
              console.log("   This will prevent HTLC contract creation.");
              console.log("   The contract may have been deployed with incorrect parameters.");
            } else {
              console.log(`⚠️  Contract creation test returned: ${response.ok.err}`);
              console.log("   This might be expected for a dry run test.");
            }
          } else if (response?.ok?.ok) {
            console.log("✅ EXCELLENT: Timelock validation works correctly!");
            console.log("   Contract creation would succeed with proper parameters.");
          } else {
            console.log("⚠️  Unexpected timelock test response format");
          }
        } else {
          console.log("❌ Timelock validation test query failed");
        }
      } catch (error) {
        console.log("❌ Timelock validation test error:", error);
      }

      console.log("\n🎉 Contract deployment and testing completed!");
      console.log("📝 If timelock validation passed, the contract is ready for use.");
      console.log("📝 If timelock validation failed, you may need to redeploy with different parameters.");
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