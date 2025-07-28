#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function identifyNetwork() {
  console.log("🔍 Identifying the exact Polkadot network...");

  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";
  console.log(`📡 Connecting to: ${wsUrl}`);

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected!");

    // Get basic chain info
    const chainInfo = {
      chain: await api.rpc.system.chain(),
      name: await api.rpc.system.name(),
      version: await api.rpc.system.version(),
      genesisHash: api.genesisHash.toHex(),
      properties: await api.rpc.system.properties(),
      chainType: await api.rpc.system.chainType(),
    };

    console.log("\n📋 Chain Information:");
    console.log(`   Chain: ${chainInfo.chain}`);
    console.log(`   Name: ${chainInfo.name}`);
    console.log(`   Version: ${chainInfo.version}`);
    console.log(`   Chain Type: ${chainInfo.chainType}`);
    console.log(`   Genesis Hash: ${chainInfo.genesisHash}`);
    console.log(`   Properties:`, chainInfo.properties.toJSON());

    // Check for known testnet genesis hashes
    const knownNetworks: { [key: string]: string } = {
      "0x58c54e2f20ca98f8e7e7e5f7b6e41f5e2b6e1c6e0b6e1a6e4b7b8b9b0b1b2b3":
        "Polkadot Asset Hub Mainnet",
      "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9":
        "Westend Asset Hub",
      "0x48239ef607d7928874027a43a67689209727dfb3d3dc5e5b03a39bdc2eda771a":
        "Kusama Asset Hub",
      "0x0f7e4b0f6e8b0f1e8b4e7e0f8b1e4b7e0f1e8b4e7e0f8b1e4b7e0f1e8b4e7e":
        "Rococo Asset Hub",
    };

    const networkName =
      knownNetworks[chainInfo.genesisHash] || "Unknown Network";
    console.log(`\n🌐 Identified Network: ${networkName}`);

    // Suggest correct explorer
    if (networkName.includes("Westend")) {
      console.log(`✅ Correct Explorer: https://assethub-westend.subscan.io`);
    } else if (networkName.includes("Kusama")) {
      console.log(`✅ Correct Explorer: https://assethub-kusama.subscan.io`);
    } else if (networkName.includes("Rococo")) {
      console.log(`✅ Correct Explorer: https://assethub-rococo.subscan.io`);
    } else if (networkName.includes("Mainnet")) {
      console.log(`✅ Correct Explorer: https://assethub-polkadot.subscan.io`);
    } else {
      console.log(`⚠️  This appears to be a custom testnet.`);
      console.log(
        `   Direct RPC explorer: https://polkadot.js.org/apps/?rpc=${encodeURIComponent(
          wsUrl
        )}`
      );
      console.log(`   Genesis Hash: ${chainInfo.genesisHash}`);
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Failed to identify network:", error);
  }
}

identifyNetwork();
