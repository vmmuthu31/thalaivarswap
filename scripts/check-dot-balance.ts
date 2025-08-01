#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const CONFIG = {
  POLKADOT_WS_URL: process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev",
  POLKADOT_SEED: process.env.POLKADOT_SEED || "//Alice",
};

async function checkDotBalance() {
  console.log("🔍 Checking DOT Account Balance...\n");

  try {
    // Initialize crypto
    await cryptoWaitReady();

    // Create keyring and account
    const keyring = new Keyring({ type: "sr25519" });
    const account = keyring.addFromUri(CONFIG.POLKADOT_SEED);

    console.log("📋 Account Information:");
    console.log(`   Address: ${account.address}`);
    console.log(`   Public Key: ${account.publicKey.toString()}`);
    console.log(`   Network: ${CONFIG.POLKADOT_WS_URL}\n`);

    // Connect to Polkadot
    console.log("🔗 Connecting to Polkadot network...");
    const wsProvider = new WsProvider(CONFIG.POLKADOT_WS_URL);
    const api = await ApiPromise.create({ provider: wsProvider });

    // Get network info
    const chain = await api.rpc.system.chain();
    const version = await api.rpc.system.version();
    console.log(`   Chain: ${chain}`);
    console.log(`   Version: ${version}\n`);

    // Check balance
    console.log("💰 Balance Information:");
    const balance = await api.query.system.account(account.address);
    const balanceData = balance.toJSON() as any;

    const free = balanceData.data?.free || balanceData.free || "0";
    const reserved = balanceData.data?.reserved || balanceData.reserved || "0";
    const frozen = balanceData.data?.frozen || balanceData.frozen || "0";

    // Convert from smallest unit to DOT (assuming 12 decimals for most Polkadot networks)
    const freeBalance = parseFloat(free.toString()) / 1e12;
    const reservedBalance = parseFloat(reserved.toString()) / 1e12;
    const frozenBalance = parseFloat(frozen.toString()) / 1e12;

    console.log(`   Free Balance: ${freeBalance.toFixed(6)} DOT`);
    console.log(`   Reserved Balance: ${reservedBalance.toFixed(6)} DOT`);
    console.log(`   Frozen Balance: ${frozenBalance.toFixed(6)} DOT`);
    console.log(`   Total Balance: ${(freeBalance + reservedBalance).toFixed(6)} DOT\n`);

    // Check if balance is sufficient
    const minimumRequired = 0.1; // Minimum DOT needed for transactions
    if (freeBalance < minimumRequired) {
      console.log("⚠️  INSUFFICIENT BALANCE!");
      console.log(`   Current: ${freeBalance.toFixed(6)} DOT`);
      console.log(`   Required: ${minimumRequired} DOT minimum\n`);
      
      console.log("💡 How to Fund Your Account:");
      console.log("   1. Copy your address: " + account.address);
      
      if (CONFIG.POLKADOT_WS_URL.includes("test.azero.dev")) {
        console.log("   2. Visit Aleph Zero Testnet Faucet:");
        console.log("      https://faucet.test.azero.dev/");
        console.log("   3. Paste your address and request testnet AZERO tokens");
      } else if (CONFIG.POLKADOT_WS_URL.includes("rococo")) {
        console.log("   2. Visit Rococo Faucet:");
        console.log("      https://faucet.polkadot.io/");
        console.log("   3. Paste your address and request testnet ROC tokens");
      } else if (CONFIG.POLKADOT_WS_URL.includes("westend")) {
        console.log("   2. Visit Westend Faucet:");
        console.log("      https://faucet.polkadot.io/westend");
        console.log("   3. Paste your address and request testnet WND tokens");
      } else {
        console.log("   2. Visit the appropriate testnet faucet for your network");
        console.log("   3. Or transfer tokens from another account");
      }
      
      console.log("   4. Wait for the transaction to confirm");
      console.log("   5. Run this script again to verify the balance\n");
    } else {
      console.log("✅ Balance is sufficient for transactions!");
    }

    // Get existential deposit
    try {
      const existentialDeposit = api.consts.balances.existentialDeposit;
      const edAmount = parseFloat(existentialDeposit.toString()) / 1e12;
      console.log(`   Existential Deposit: ${edAmount.toFixed(6)} DOT`);
    } catch (error) {
      console.log("   Could not fetch existential deposit");
    }

    await api.disconnect();

  } catch (error) {
    console.error("❌ Error checking balance:", error);
    process.exit(1);
  }
}

// Run the script
checkDotBalance().catch(console.error);