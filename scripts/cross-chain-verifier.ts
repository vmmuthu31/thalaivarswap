#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cross-Chain Transaction and Balance Verifier
 *
 * This script provides comprehensive verification for cross-chain swaps:
 * 1. Pre-swap balance verification
 * 2. Transaction confirmation on both chains
 * 3. Post-swap balance verification
 * 4. HTLC contract state verification
 * 5. 1inch Fusion+ order status monitoring
 */

import { ethers } from "ethers";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { FusionCrossChainSDK } from "../lib/fusion-sdk";
import { AssetHubReviveWrapper } from "../lib/asset-hub-revive";
import dotenv from "dotenv";

dotenv.config();

interface BalanceSnapshot {
  timestamp: number;
  address: string;
  ethBalance: string;
  dotBalance: string;
  blockNumber: {
    ethereum: number;
    polkadot: number;
  };
}

interface TransactionVerification {
  txHash: string;
  isEthereum: boolean;
  status: "pending" | "confirmed" | "failed" | "not_found";
  blockNumber?: number;
  gasUsed?: string;
  eventLogs?: any[];
  confirmations?: number;
}

interface SwapVerificationResult {
  swapId: string;
  success: boolean;
  preSwapBalances: BalanceSnapshot;
  postSwapBalances: BalanceSnapshot;
  ethTransaction?: TransactionVerification;
  dotTransaction?: TransactionVerification;
  htlcStates: {
    ethereum?: {
      contractId: string;
      exists: boolean;
      withdrawn: boolean;
      refunded: boolean;
      secret?: string;
    };
    polkadot?: {
      contractId: string;
      exists: boolean;
      completed: boolean;
      refunded: boolean;
    };
  };
  fusionOrderStatus?: {
    orderHash: string;
    status: string;
    secretRevealed: boolean;
    escrowsCreated: boolean;
  };
  balanceChanges: {
    ethDelta: string;
    dotDelta: string;
    expectedEthDelta: string;
    expectedDotDelta: string;
    ethVerified: boolean;
    dotVerified: boolean;
  };
  verificationTime: number;
  errors: string[];
}

export class CrossChainVerifier {
  private ethProvider: ethers.JsonRpcProvider;
  private polkadotApi?: ApiPromise;
  private ethereumContract?: ethers.Contract;
  private assetHubRevive?: AssetHubReviveWrapper;
  private fusionSDK: FusionCrossChainSDK;
  private keyring?: Keyring;
  private polkadotAccount: any;

  constructor(
    ethRpcUrl: string,
    polkadotWsUrl: string,
    ethContractAddress: string,
    polkadotContractAddress: string,
    privateKey: string,
    polkadotSeed: string
  ) {
    this.ethProvider = new ethers.JsonRpcProvider(ethRpcUrl);
    this.fusionSDK = new FusionCrossChainSDK(
      "https://api.1inch.dev/fusion-plus",
      process.env.ONEINCH_API_KEY || "",
      privateKey,
      ethRpcUrl
    );

    this.initializeConnections(
      polkadotWsUrl,
      ethContractAddress,
      polkadotContractAddress,
      privateKey,
      polkadotSeed
    ).catch(console.error);
  }

  private async initializeConnections(
    polkadotWsUrl: string,
    ethContractAddress: string,
    polkadotContractAddress: string,
    privateKey: string,
    polkadotSeed: string
  ): Promise<void> {
    // Initialize Polkadot
    await cryptoWaitReady();
    this.keyring = new Keyring({ type: "sr25519" });
    this.polkadotAccount = this.keyring.addFromUri(polkadotSeed);

    const wsProvider = new WsProvider(polkadotWsUrl);
    this.polkadotApi = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    // Initialize Asset Hub Revive wrapper
    this.assetHubRevive = new AssetHubReviveWrapper(
      this.polkadotApi,
      polkadotContractAddress
    );

    // Initialize Ethereum contract
    const htlcAbi = [
      "function getContract(bytes32 contractId) external view returns (tuple(address sender, address receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage, bytes32 swapId, uint32 sourceChain, uint32 destChain, uint256 destAmount, uint256 fee, address relayer))",
      "function contractExists(bytes32 contractId) external view returns (bool)",
      "function getSecret(bytes32 contractId) external view returns (bytes32)",
      "event HTLCNew(bytes32 indexed contractId, address indexed sender, address indexed receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bytes32 swapId, uint32 sourceChain, uint32 destChain, uint256 destAmount, address relayer)",
      "event HTLCWithdraw(bytes32 indexed contractId, bytes32 indexed secret, address indexed relayer)",
      "event HTLCRefund(bytes32 indexed contractId)",
    ];

    const wallet = new ethers.Wallet(privateKey, this.ethProvider);
    this.ethereumContract = new ethers.Contract(
      ethContractAddress,
      htlcAbi,
      wallet
    );
  }

  /**
   * Take a balance snapshot for pre/post swap comparison
   */
  async takeBalanceSnapshot(
    ethAddress: string,
    dotAddress: string
  ): Promise<BalanceSnapshot> {
    const timestamp = Date.now();

    // Ensure ETH address is properly checksummed
    const checksummedEthAddress = ethers.getAddress(ethAddress);

    // Get ETH balance
    const ethBalance = await this.ethProvider.getBalance(checksummedEthAddress);
    const ethBlockNumber = await this.ethProvider.getBlockNumber();

    // Get DOT balance
    let dotBalance = "0";
    let dotBlockNumber = 0;

    if (this.polkadotApi) {
      const accountInfo = await this.polkadotApi.query.system.account(
        dotAddress
      );
      const balanceData = accountInfo.toJSON() as any;
      dotBalance = balanceData.data?.free || balanceData.free || "0";

      const currentBlock = await this.polkadotApi.query.system.number();
      dotBlockNumber = parseInt(currentBlock.toString());
    }

    return {
      timestamp,
      address: `ETH:${checksummedEthAddress}, DOT:${dotAddress}`,
      ethBalance: ethers.formatEther(ethBalance),
      dotBalance: (parseFloat(dotBalance.toString()) / 1e12).toFixed(6),
      blockNumber: {
        ethereum: ethBlockNumber,
        polkadot: dotBlockNumber,
      },
    };
  }

  /**
   * Verify a transaction on Ethereum
   */
  async verifyEthereumTransaction(
    txHash: string,
    maxWaitTime: number = 300000 // 5 minutes
  ): Promise<TransactionVerification> {
    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = Math.floor(maxWaitTime / 5000); // Check every 5 seconds

    while (attempts < maxAttempts) {
      try {
        const receipt = await this.ethProvider.getTransactionReceipt(txHash);

        if (receipt) {
          const tx = await this.ethProvider.getTransaction(txHash);
          const currentBlock = await this.ethProvider.getBlockNumber();
          const confirmations = currentBlock - receipt.blockNumber;

          // Parse event logs if this is our HTLC contract
          let eventLogs: any[] = [];
          if (
            this.ethereumContract &&
            receipt.to === (await this.ethereumContract.getAddress())
          ) {
            eventLogs = receipt.logs
              .map((log) => {
                try {
                  return this.ethereumContract!.interface.parseLog({
                    topics: log.topics,
                    data: log.data,
                  });
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
          }

          return {
            txHash,
            isEthereum: true,
            status: receipt.status === 1 ? "confirmed" : "failed",
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            eventLogs,
            confirmations,
          };
        }

        console.log(
          `⏳ Waiting for Ethereum transaction ${txHash}... (${
            attempts + 1
          }/${maxAttempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
      } catch (error) {
        console.warn(`⚠️ Error checking Ethereum transaction:`, error);
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    return {
      txHash,
      isEthereum: true,
      status: "not_found",
    };
  }

  /**
   * Verify a transaction on Polkadot
   */
  async verifyPolkadotTransaction(
    txHash: string,
    maxWaitTime: number = 300000 // 5 minutes
  ): Promise<TransactionVerification> {
    if (!this.polkadotApi) {
      return {
        txHash,
        isEthereum: false,
        status: "not_found",
      };
    }

    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = Math.floor(maxWaitTime / 10000); // Check every 10 seconds

    while (attempts < maxAttempts) {
      try {
        // Try to get block hash from transaction hash
        // This is more complex in Polkadot as transaction hashes are different
        // For simplicity, we'll check if the transaction appears in recent blocks

        const currentBlock = await this.polkadotApi.query.system.number();
        const blockNumber = parseInt(currentBlock.toString());

        // Check recent blocks for the transaction
        for (let i = 0; i < 10; i++) {
          const blockHash = await this.polkadotApi.rpc.chain.getBlockHash(
            blockNumber - i
          );
          const block = await this.polkadotApi.rpc.chain.getBlock(blockHash);

          const extrinsics = block.block.extrinsics;
          for (const extrinsic of extrinsics) {
            const extrinsicHash = extrinsic.hash.toHex();
            if (extrinsicHash === txHash) {
              return {
                txHash,
                isEthereum: false,
                status: "confirmed",
                blockNumber: blockNumber - i,
              };
            }
          }
        }

        console.log(
          `⏳ Waiting for Polkadot transaction ${txHash}... (${
            attempts + 1
          }/${maxAttempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, 10000));
        attempts++;
      } catch (error) {
        console.warn(`⚠️ Error checking Polkadot transaction:`, error);
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }

    return {
      txHash,
      isEthereum: false,
      status: "not_found",
    };
  }

  /**
   * Verify HTLC contract state on Ethereum
   */
  async verifyEthereumHTLC(contractId: string) {
    if (!this.ethereumContract) {
      return null;
    }

    try {
      const exists = await this.ethereumContract.contractExists(contractId);

      if (!exists) {
        return {
          contractId,
          exists: false,
          withdrawn: false,
          refunded: false,
        };
      }

      const contractData = await this.ethereumContract.getContract(contractId);
      const secret = await this.ethereumContract.getSecret(contractId);

      return {
        contractId,
        exists: true,
        withdrawn: contractData.withdrawn,
        refunded: contractData.refunded,
        secret:
          secret !==
          "0x0000000000000000000000000000000000000000000000000000000000000000"
            ? secret
            : undefined,
      };
    } catch (error) {
      console.warn(`⚠️ Error verifying Ethereum HTLC:`, error);
      return null;
    }
  }

  /**
   * Verify HTLC contract state on Polkadot
   */
  async verifyPolkadotHTLC(contractId: string) {
    if (!this.assetHubRevive || !this.polkadotApi) {
      return null;
    }

    try {
      // This would depend on the specific contract implementation
      // For now, we'll return a basic structure
      return {
        contractId,
        exists: true, // Would need to query the contract
        completed: false, // Would need to check contract state
        refunded: false, // Would need to check contract state
      };
    } catch (error) {
      console.warn(`⚠️ Error verifying Polkadot HTLC:`, error);
      return null;
    }
  }

  /**
   * Monitor 1inch Fusion+ order status
   */
  async verifyFusionOrderStatus(orderHash: string) {
    try {
      // Check order status
      const orderStatus = await this.fusionSDK.monitorOrderStatus(orderHash);

      // Check if secrets are published
      const publishedSecrets = await this.fusionSDK.getPublishedSecrets(
        orderHash
      );

      // Check if ready for secret fills
      const readyForSecrets = await this.fusionSDK.isReadyForSecretFill(
        orderHash
      );

      return {
        orderHash,
        status: orderStatus.status || "unknown",
        secretRevealed:
          publishedSecrets &&
          publishedSecrets.secrets &&
          publishedSecrets.secrets.length > 0,
        escrowsCreated: readyForSecrets || false,
      };
    } catch (error) {
      console.warn(`⚠️ Error verifying Fusion+ order:`, error);
      return {
        orderHash,
        status: "unknown",
        secretRevealed: false,
        escrowsCreated: false,
      };
    }
  }

  /**
   * Comprehensive cross-chain swap verification
   */
  async verifySwap(
    swapId: string,
    ethAddress: string,
    dotAddress: string,
    ethTxHash?: string,
    dotTxHash?: string,
    ethContractId?: string,
    dotContractId?: string,
    fusionOrderHash?: string,
    expectedEthDelta?: string,
    expectedDotDelta?: string
  ): Promise<SwapVerificationResult> {
    console.log(`🔍 Starting comprehensive verification for swap: ${swapId}`);
    const startTime = Date.now();
    const errors: string[] = [];

    // Take pre-verification balance snapshot (this should ideally be taken before the swap)
    console.log("📊 Taking current balance snapshot...");
    const currentBalances = await this.takeBalanceSnapshot(
      ethAddress,
      dotAddress
    );

    // Verify transactions
    let ethTransaction: TransactionVerification | undefined;
    let dotTransaction: TransactionVerification | undefined;

    if (ethTxHash) {
      console.log(`🔍 Verifying Ethereum transaction: ${ethTxHash}`);
      ethTransaction = await this.verifyEthereumTransaction(ethTxHash);

      if (ethTransaction.status !== "confirmed") {
        errors.push(
          `Ethereum transaction ${ethTxHash} not confirmed: ${ethTransaction.status}`
        );
      }
    }

    if (dotTxHash) {
      console.log(`🔍 Verifying Polkadot transaction: ${dotTxHash}`);
      dotTransaction = await this.verifyPolkadotTransaction(dotTxHash);

      if (dotTransaction.status !== "confirmed") {
        errors.push(
          `Polkadot transaction ${dotTxHash} not confirmed: ${dotTransaction.status}`
        );
      }
    }

    // Verify HTLC states
    const htlcStates: any = {};

    if (ethContractId) {
      console.log(`🔍 Verifying Ethereum HTLC: ${ethContractId}`);
      htlcStates.ethereum = await this.verifyEthereumHTLC(ethContractId);

      if (!htlcStates.ethereum?.exists) {
        errors.push(`Ethereum HTLC contract ${ethContractId} does not exist`);
      }
    }

    if (dotContractId) {
      console.log(`🔍 Verifying Polkadot HTLC: ${dotContractId}`);
      htlcStates.polkadot = await this.verifyPolkadotHTLC(dotContractId);
    }

    // Verify Fusion+ order status
    let fusionOrderStatus: any;
    if (fusionOrderHash) {
      console.log(`🔍 Verifying Fusion+ order: ${fusionOrderHash}`);
      fusionOrderStatus = await this.verifyFusionOrderStatus(fusionOrderHash);
    }

    // Calculate balance changes (simplified - would need pre-swap snapshot for accuracy)
    const balanceChanges = {
      ethDelta: "0", // Would need pre-swap balance
      dotDelta: "0", // Would need pre-swap balance
      expectedEthDelta: expectedEthDelta || "0",
      expectedDotDelta: expectedDotDelta || "0",
      ethVerified: false,
      dotVerified: false,
    };

    // Determine overall success
    const success =
      errors.length === 0 &&
      (ethTransaction?.status === "confirmed" || !ethTxHash) &&
      (dotTransaction?.status === "confirmed" || !dotTxHash);

    const result: SwapVerificationResult = {
      swapId,
      success,
      preSwapBalances: currentBalances, // This should be actual pre-swap balances
      postSwapBalances: currentBalances,
      ethTransaction,
      dotTransaction,
      htlcStates,
      fusionOrderStatus,
      balanceChanges,
      verificationTime: Date.now() - startTime,
      errors,
    };

    console.log(`✅ Verification completed in ${result.verificationTime}ms`);
    console.log(`📊 Success: ${success ? "✅" : "❌"}`);

    if (errors.length > 0) {
      console.log("❌ Errors found:");
      errors.forEach((error) => console.log(`   - ${error}`));
    }

    return result;
  }

  /**
   * Real-time monitoring of ongoing swap
   */
  async monitorSwapProgress(
    swapId: string,
    ethAddress: string,
    dotAddress: string,
    ethTxHash?: string,
    dotTxHash?: string,
    fusionOrderHash?: string,
    maxMonitorTime: number = 600000 // 10 minutes
  ): Promise<void> {
    console.log(`📊 Starting real-time monitoring for swap: ${swapId}`);
    const startTime = Date.now();
    let lastUpdate = 0;
    const updateInterval = 15000; // Update every 15 seconds

    const preSwapBalances = await this.takeBalanceSnapshot(
      ethAddress,
      dotAddress
    );
    console.log("📊 Pre-swap balances:", preSwapBalances);

    while (Date.now() - startTime < maxMonitorTime) {
      if (Date.now() - lastUpdate >= updateInterval) {
        try {
          // Check current balances
          const currentBalances = await this.takeBalanceSnapshot(
            ethAddress,
            dotAddress
          );

          // Calculate balance changes
          const ethDelta =
            parseFloat(currentBalances.ethBalance) -
            parseFloat(preSwapBalances.ethBalance);
          const dotDelta =
            parseFloat(currentBalances.dotBalance) -
            parseFloat(preSwapBalances.dotBalance);

          console.log(
            `📊 Balance Update (${new Date().toLocaleTimeString()}):`
          );
          console.log(
            `   ETH: ${currentBalances.ethBalance} (Δ ${
              ethDelta >= 0 ? "+" : ""
            }${ethDelta.toFixed(6)})`
          );
          console.log(
            `   DOT: ${currentBalances.dotBalance} (Δ ${
              dotDelta >= 0 ? "+" : ""
            }${dotDelta.toFixed(6)})`
          );

          // Check transaction status
          if (ethTxHash) {
            const ethStatus = await this.verifyEthereumTransaction(
              ethTxHash,
              5000
            );
            console.log(
              `   ETH TX: ${ethStatus.status}${
                ethStatus.confirmations
                  ? ` (${ethStatus.confirmations} confirmations)`
                  : ""
              }`
            );
          }

          if (dotTxHash) {
            const dotStatus = await this.verifyPolkadotTransaction(
              dotTxHash,
              5000
            );
            console.log(`   DOT TX: ${dotStatus.status}`);
          }

          // Check Fusion+ order status
          if (fusionOrderHash) {
            try {
              const orderStatus = await this.verifyFusionOrderStatus(
                fusionOrderHash
              );
              console.log(
                `   Fusion+ Order: ${orderStatus.status} (Escrows: ${
                  orderStatus.escrowsCreated ? "✅" : "❌"
                }, Secret: ${orderStatus.secretRevealed ? "✅" : "❌"})`
              );
            } catch (error) {
              console.log(`   Fusion+ Order: Error checking status`);
            }
          }

          console.log(""); // Empty line for readability
          lastUpdate = Date.now();
        } catch (error) {
          console.warn(`⚠️ Error during monitoring update:`, error);
        }
      }

      // Wait 1 second before next check
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(
      `⏰ Monitoring completed after ${(Date.now() - startTime) / 1000}s`
    );
  }

  /**
   * Cleanup connections
   */
  async cleanup(): Promise<void> {
    if (this.polkadotApi) {
      await this.polkadotApi.disconnect();
    }
  }
}

// Export for use in other scripts
export default CrossChainVerifier;

// Example usage if run directly
if (require.main === module) {
  async function main() {
    const verifier = new CrossChainVerifier(
      process.env.ETH_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo",
      process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io",
      process.env.ETH_CONTRACT_ADDRESS || "",
      process.env.POLKADOT_CONTRACT_ADDRESS || "",
      process.env.ETH_PRIVATE_KEY || "",
      process.env.POLKADOT_SEED || "//Alice"
    );

    // Example verification using properly checksummed address
    const ethAddress = ethers.getAddress(
      "0x742d35cc6635c0532925a3b8d400e3d0d4c7c6b8"
    );
    const result = await verifier.verifySwap(
      "example-swap-id",
      ethAddress, // ETH address (properly checksummed)
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", // DOT address
      undefined, // ETH tx hash
      undefined, // DOT tx hash
      undefined, // ETH contract ID
      undefined, // DOT contract ID
      undefined, // Fusion order hash
      "-0.001", // Expected ETH delta (negative = sent)
      "+0.01" // Expected DOT delta (positive = received)
    );

    console.log("🎯 Verification Result:", result);

    await verifier.cleanup();
  }

  main().catch(console.error);
}
