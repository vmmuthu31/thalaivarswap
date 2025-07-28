#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

const POLKADOT_WS_URL =
  process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";

async function debugNetwork() {
  console.log("🔍 Debugging Polkadot network connection...");
  console.log(`📡 Connecting to: ${POLKADOT_WS_URL}`);

  try {
    const wsProvider = new WsProvider(POLKADOT_WS_URL);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected successfully!");
    console.log(`🔗 Chain: ${await api.rpc.system.chain()}`);
    console.log(`📋 Name: ${await api.rpc.system.name()}`);
    console.log(`🔢 Version: ${await api.rpc.system.version()}`);
    console.log(`🆔 Chain Type: ${await api.rpc.system.chainType()}`);

    // Get chain spec info
    const properties = await api.rpc.system.properties();
    console.log(`🏷️  Properties:`, properties.toJSON());

    // Get current block
    const currentBlock = await api.rpc.chain.getBlock();
    console.log(`📦 Current block number: ${currentBlock.block.header.number}`);
    console.log(`🔗 Current block hash: ${currentBlock.block.header.hash}`);

    // Check if this is Paseo or Asset Hub
    const genesisHash = await api.genesisHash;
    console.log(`🧬 Genesis hash: ${genesisHash}`);

    // Check available modules
    const modules = Object.keys(api.tx);
    console.log(
      `📚 Available modules:`,
      modules.slice(0, 10).join(", "),
      "..."
    );

    // Check if it has revive or contracts
    console.log(`💼 Has contracts pallet: ${modules.includes("contracts")}`);
    console.log(`🔄 Has revive pallet: ${modules.includes("revive")}`);

    await api.disconnect();
  } catch (error) {
    console.error("❌ Failed to connect:", error);
  }
}

debugNetwork();
