#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Demo Script: ETH → DOT Cross-Chain Swap
 *
 * This script demonstrates a complete ETH to DOT cross-chain swap using:
 * - Ethereum Sepolia testnet
 * - Rococo testnet (Polkadot)
 * - 1inch Fusion+ protocol
 * - Bidirectional HTLC relayer
 */

import { ethers } from "ethers";
import { BidirectionalRelayer } from "../lib/bidirectional-relayer";
import { FusionCrossChainSDK } from "../lib/fusion-sdk";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration
const CONFIG = {
  // Ethereum Sepolia
  ETH_RPC_URL:
    process.env.ETH_RPC_URL ||
    "https://eth-sepolia.g.alchemy.com/v2/your-api-key",
  ETH_PRIVATE_KEY: process.env.ETH_PRIVATE_KEY || "",
  ETH_CONTRACT_ADDRESS: process.env.ETH_CONTRACT_ADDRESS || "0x...", // Deployed EVM relayer contract

  // Polkadot Rococo
  POLKADOT_WS_URL:
    process.env.POLKADOT_WS_URL || "wss://rococo-rpc.polkadot.io",
  POLKADOT_SEED: process.env.POLKADOT_SEED || "//Alice",
  POLKADOT_CONTRACT_ADDRESS:
    process.env.POLKADOT_CONTRACT_ADDRESS ||
    "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",

  // 1inch Fusion+
  FUSION_API_KEY: process.env.FUSION_API_KEY || "",

  // Demo parameters
  ETH_AMOUNT: "0.01", // 0.01 ETH
  ETH_SENDER: "", // Will be derived from private key
  DOT_RECIPIENT: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", // Example DOT address
};

interface DemoResult {
  success: boolean;
  swapId?: string;
  ethTxHash?: string;
  dotTxHash?: string;
  fusionOrderHash?: string;
  error?: string;
  duration?: number;
  steps: string[];
}

class ETHToDOTDemo {
  private relayer: BidirectionalRelayer;
  private fusionSDK: FusionCrossChainSDK;
  private ethProvider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private steps: string[] = [];
  private startTime: number = 0;

  constructor() {
    // Initialize providers
    this.ethProvider = new ethers.JsonRpcProvider(CONFIG.ETH_RPC_URL);
    this.wallet = new ethers.Wallet(CONFIG.ETH_PRIVATE_KEY, this.ethProvider);
    CONFIG.ETH_SENDER = this.wallet.address;

    // Initialize relayer and SDK
    this.relayer = new BidirectionalRelayer(
      CONFIG.ETH_RPC_URL,
      CONFIG.ETH_CONTRACT_ADDRESS,
      CONFIG.FUSION_API_KEY
    );

    this.fusionSDK = new FusionCrossChainSDK(
      "https://api.1inch.dev/fusion-plus",
      CONFIG.FUSION_API_KEY,
      CONFIG.ETH_PRIVATE_KEY,
      CONFIG.ETH_RPC_URL
    );
  }

  /**
   * Run the complete ETH → DOT demo
   */
  async runDemo(): Promise<DemoResult> {
    this.startTime = Date.now();
    console.log("🚀 Starting ETH → DOT Cross-Chain Swap Demo");
    console.log("=".repeat(60));

    try {
      // Step 1: Initialize systems
      await this.initializeSystems();

      // Step 2: Check balances
      await this.checkBalances();

      // Step 3: Create the cross-chain swap
      const swap = await this.createSwap();

      // Step 4: Execute the swap
      await this.executeSwap(swap.swapId);

      // Step 5: Monitor completion
      const finalSwap = await this.monitorCompletion(swap.swapId);

      // Step 6: Verify results
      await this.verifyResults(finalSwap);

      const duration = Date.now() - this.startTime;

      return {
        success: true,
        swapId: swap.swapId,
        fusionOrderHash: swap.fusionOrder?.orderHash,
        duration,
        steps: this.steps,
      };
    } catch (error) {
      console.error("❌ Demo failed:", error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - this.startTime,
        steps: this.steps,
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Initialize all systems
   */
  private async initializeSystems(): Promise<void> {
    this.addStep("Initializing bidirectional relayer...");

    // Initialize relayer
    await this.relayer.initialize();

    // Start monitoring
    await this.relayer.startMonitoring();

    // Set up event listeners
    this.setupEventListeners();

    this.addStep("✅ All systems initialized");
  }

  /**
   * Check initial balances
   */
  private async checkBalances(): Promise<void> {
    this.addStep("Checking initial balances...");

    // Check ETH balance
    const ethBalance = await this.ethProvider.getBalance(this.wallet.address);
    console.log(`💰 ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

    if (ethBalance < ethers.parseEther(CONFIG.ETH_AMOUNT)) {
      throw new Error(
        `Insufficient ETH balance. Need ${
          CONFIG.ETH_AMOUNT
        } ETH, have ${ethers.formatEther(ethBalance)} ETH`
      );
    }

    // Note: In a real implementation, you'd also check DOT balance on the recipient side

    this.addStep("✅ Balances verified");
  }

  /**
   * Create the cross-chain swap
   */
  private async createSwap() {
    this.addStep("Creating ETH → DOT swap...");

    const swap = await this.relayer.createEthToDotSwap(
      CONFIG.ETH_AMOUNT,
      CONFIG.ETH_SENDER,
      CONFIG.DOT_RECIPIENT
    );

    console.log(`📝 Swap created with ID: ${swap.swapId}`);
    console.log(`🔗 Fusion+ Order Hash: ${swap.fusionOrder?.orderHash}`);

    this.addStep(`✅ Swap created: ${swap.swapId.substring(0, 10)}...`);

    return swap;
  }

  /**
   * Execute the swap
   */
  private async executeSwap(swapId: string): Promise<void> {
    this.addStep("Executing bidirectional swap...");

    const swap = this.relayer.getSwap(swapId);
    if (!swap) {
      throw new Error("Swap not found");
    }

    // Execute the swap (this will create escrows on both chains)
    await this.relayer.executeBidirectionalSwap(swap);

    this.addStep("✅ Swap execution initiated");
  }

  /**
   * Monitor swap completion
   */
  private async monitorCompletion(
    swapId: string,
    timeoutMs: number = 300000
  ): Promise<any> {
    this.addStep("Monitoring swap completion...");

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const swap = this.relayer.getSwap(swapId);

      if (!swap) {
        throw new Error("Swap not found during monitoring");
      }

      console.log(`📊 Swap Status: ${swap.status}`);

      if (swap.status === "completed") {
        this.addStep("✅ Swap completed successfully");
        return swap;
      }

      if (swap.status === "failed" || swap.status === "refunded") {
        throw new Error(`Swap ${swap.status}`);
      }

      // Wait 10 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    throw new Error("Swap monitoring timeout");
  }

  /**
   * Verify final results
   */
  private async verifyResults(swap: any): Promise<void> {
    this.addStep("Verifying swap results...");

    // Check that both escrows were created and withdrawn
    if (!swap.ethEscrow || !swap.dotEscrow) {
      throw new Error("Escrows not properly created");
    }

    if (!swap.ethEscrow.withdrawn || !swap.dotEscrow.withdrawn) {
      throw new Error("Escrows not properly withdrawn");
    }

    console.log("🔍 Verification Results:");
    console.log(
      `   ETH Escrow: ${
        swap.ethEscrow.withdrawn ? "✅ Withdrawn" : "❌ Not withdrawn"
      }`
    );
    console.log(
      `   DOT Escrow: ${
        swap.dotEscrow.withdrawn ? "✅ Withdrawn" : "❌ Not withdrawn"
      }`
    );
    console.log(
      `   Secret revealed: ${swap.ethEscrow.preimage ? "✅ Yes" : "❌ No"}`
    );

    // Check final balances
    const finalEthBalance = await this.ethProvider.getBalance(
      this.wallet.address
    );
    console.log(
      `💰 Final ETH Balance: ${ethers.formatEther(finalEthBalance)} ETH`
    );

    this.addStep("✅ Results verified");
  }

  /**
   * Set up event listeners for monitoring
   */
  private setupEventListeners(): void {
    this.relayer.on("swap-created", (swap) => {
      console.log(`🎉 Swap Created: ${swap.swapId}`);
    });

    this.relayer.on("escrow-created", (swap, chain) => {
      console.log(`🔒 Escrow created on ${chain} for swap ${swap.swapId}`);
    });

    this.relayer.on("swap-ready", (swap) => {
      console.log(`✅ Swap ${swap.swapId} is ready for completion`);
    });

    this.relayer.on("swap-completed", (swap) => {
      console.log(`🎊 Swap ${swap.swapId} completed successfully!`);
    });

    this.relayer.on("swap-failed", (swap, error) => {
      console.error(`❌ Swap ${swap.swapId} failed:`, error);
    });

    this.relayer.on("ethereum-htlc-created", (event) => {
      console.log(`📡 Ethereum HTLC Created: ${event.contractId}`);
    });

    this.relayer.on("ethereum-htlc-withdrawn", (event) => {
      console.log(`🔓 Ethereum HTLC Withdrawn: ${event.contractId}`);
    });
  }

  /**
   * Add a step to the demo log
   */
  private addStep(step: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${step}`;
    this.steps.push(logEntry);
    console.log(logEntry);
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    console.log("🧹 Cleaning up demo resources...");

    try {
      await this.relayer.cleanup();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }
}

/**
 * Display demo results
 */
function displayResults(result: DemoResult): void {
  console.log("\n" + "=".repeat(60));
  console.log("📊 DEMO RESULTS");
  console.log("=".repeat(60));

  console.log(`Status: ${result.success ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log(
    `Duration: ${result.duration ? Math.round(result.duration / 1000) : 0}s`
  );

  if (result.swapId) {
    console.log(`Swap ID: ${result.swapId}`);
  }

  if (result.fusionOrderHash) {
    console.log(`Fusion+ Order: ${result.fusionOrderHash}`);
  }

  if (result.ethTxHash) {
    console.log(
      `ETH Transaction: https://sepolia.etherscan.io/tx/${result.ethTxHash}`
    );
  }

  if (result.dotTxHash) {
    console.log(
      `DOT Transaction: https://rococo.subscan.io/extrinsic/${result.dotTxHash}`
    );
  }

  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  console.log("\n📝 Execution Steps:");
  result.steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step}`);
  });

  console.log("\n" + "=".repeat(60));
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log("🌟 ETH → DOT Cross-Chain Swap Demo");
  console.log(
    "This demo will execute a complete cross-chain swap from Ethereum to Polkadot"
  );
  console.log("");

  // Validate configuration
  if (!CONFIG.ETH_PRIVATE_KEY || !CONFIG.FUSION_API_KEY) {
    console.error("❌ Missing required environment variables:");
    console.error("   - ETH_PRIVATE_KEY: Your Ethereum private key");
    console.error("   - FUSION_API_KEY: Your 1inch Fusion+ API key");
    process.exit(1);
  }

  const demo = new ETHToDOTDemo();
  const result = await demo.runDemo();

  displayResults(result);

  process.exit(result.success ? 0 : 1);
}

// Run the demo if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
}

export { ETHToDOTDemo };
export type { DemoResult };
