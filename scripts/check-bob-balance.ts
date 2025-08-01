#!/usr/bin/env tsx

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";

async function checkBobBalance() {
    console.log("🔍 Checking Bob's Account Balance...");

    // Wait for WASM to be ready
    await cryptoWaitReady();

    // Setup account
    const keyring = new Keyring({ type: "sr25519" });
    const account = keyring.addFromUri("//Bob");

    console.log("\n📋 Account Information:");
    console.log(`   Address: ${account.address}`);
    console.log(`   Network: ${process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev"}`);

    // Connect to Polkadot node
    const wsProvider = new WsProvider(process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev");
    const api = await ApiPromise.create({ provider: wsProvider });

    console.log("\n🔗 Connecting to Polkadot network...");
    const [chain, version] = await Promise.all([
        api.rpc.system.chain(),
        api.rpc.system.version(),
    ]);

    console.log(`   Chain: ${chain}`);
    console.log(`   Version: ${version}`);

    // Get account balance
    const accountInfo = await api.query.system.account(account.address);
    const balance = (accountInfo as any).data;

    console.log("\n💰 Balance Information:");
    console.log(`   Free Balance: ${balance.free.toHuman()}`);
    console.log(`   Reserved Balance: ${balance.reserved.toHuman()}`);
    console.log(`   Frozen Balance: ${balance.frozen.toHuman()}`);

    const totalBalance = balance.free.add(balance.reserved);
    console.log(`   Total Balance: ${totalBalance.toHuman()}`);

    // Check if balance is sufficient
    const existentialDeposit = api.consts.balances.existentialDeposit;
    console.log(`\n✅ Balance check complete!`);
    console.log(`   Existential Deposit: ${existentialDeposit.toHuman()}`);

    await api.disconnect();
}

checkBobBalance().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});