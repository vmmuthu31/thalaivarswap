#!/usr/bin/env ts-node

/**
 * Address Mapping Preparation Script
 *
 * This script helps prepare the correct address format for calling the
 * map_address function in the deployed Polkadot ink! contract.
 */

import { Keyring } from "@polkadot/keyring";
import { ethers } from "ethers";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

interface AddressMappingHelper {
  substrateAddress: string;
  substrateBytes: Uint8Array;
  ethereumAddress?: string;
  ethereumBytes?: Uint8Array;
  mappingCall: string;
}

async function prepareAddressMapping(): Promise<AddressMappingHelper> {
  await cryptoWaitReady();

  // Initialize Polkadot keyring
  const keyring = new Keyring({ type: "sr25519" });

  // Get the seed phrase from environment or use default Alice
  const seedPhrase = process.env.POLKADOT_SEED || "//Alice";
  const account = keyring.addFromUri(seedPhrase);

  // Get Substrate address info
  const substrateAddress = account.address;
  const substrateBytes = account.publicKey;

  console.log("🔑 Substrate Account Information:");
  console.log(`   Address: ${substrateAddress}`);
  console.log(
    `   Public Key (hex): 0x${Buffer.from(substrateBytes).toString("hex")}`
  );
  console.log(
    `   Public Key (bytes): [${Array.from(substrateBytes).join(", ")}]`
  );

  let ethereumAddress: string | undefined;
  let ethereumBytes: Uint8Array | undefined;

  // Get Ethereum address if private key is available
  if (process.env.ETH_PRIVATE_KEY) {
    try {
      const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY);
      ethereumAddress = wallet.address;
      // Remove 0x prefix and convert to bytes
      ethereumBytes = new Uint8Array(
        Buffer.from(ethereumAddress.slice(2), "hex")
      );

      console.log("\n💰 Ethereum Account Information:");
      console.log(`   Address: ${ethereumAddress}`);
      console.log(
        `   Address (bytes): [${Array.from(ethereumBytes).join(", ")}]`
      );
    } catch (error) {
      console.log("\n⚠️  Could not load Ethereum address from ETH_PRIVATE_KEY");
    }
  }

  // Generate mapping call formats
  console.log("\n📝 Contract Call Formats:");
  console.log("\n1. For Substrate Address Mapping:");
  console.log(`   Function: map_address`);
  console.log(
    `   Parameter: CrossChainAddress::Substrate([${Array.from(
      substrateBytes
    ).join(", ")}])`
  );

  if (ethereumBytes) {
    console.log("\n2. For Ethereum Address Mapping:");
    console.log(`   Function: map_address`);
    console.log(
      `   Parameter: CrossChainAddress::Ethereum([${Array.from(
        ethereumBytes
      ).join(", ")}])`
    );
  }

  // Generate the most common mapping call (Substrate)
  const mappingCall = `CrossChainAddress::Substrate([${Array.from(
    substrateBytes
  ).join(", ")}])`;

  console.log("\n🎯 Recommended Action:");
  console.log(
    "After deploying your contract, call the 'map_address' function with:"
  );
  console.log(`   ${mappingCall}`);

  console.log("\n📋 Step-by-Step Instructions:");
  console.log("1. Complete the contract deployment by clicking 'Next'");
  console.log("2. Navigate to the deployed contract in the UI");
  console.log("3. Find the 'map_address' function");
  console.log("4. Select 'CrossChainAddress::Substrate' as the variant");
  console.log("5. Enter the 32-byte array above in the input field");
  console.log("6. Execute the transaction");
  console.log(
    "7. After successful mapping, you can use all other contract functions"
  );

  return {
    substrateAddress,
    substrateBytes,
    ethereumAddress,
    ethereumBytes,
    mappingCall,
  };
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  prepareAddressMapping()
    .then(() => {
      console.log("\n✅ Address mapping preparation complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error preparing address mapping:", error);
      process.exit(1);
    });
}

export { prepareAddressMapping };
