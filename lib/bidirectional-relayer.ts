/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from "ethers";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { FusionCrossChainSDK, SwapOrder, POLKADOT_CONFIG } from "./fusion-sdk";
import { EventEmitter } from "events";

const EVM_RELAYER_ABI = [
  "event HTLCNew(bytes32 indexed contractId, address indexed sender, address indexed receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bytes32 swapId)",
  "event HTLCWithdraw(bytes32 indexed contractId, bytes32 indexed secret)",
  "event HTLCRefund(bytes32 indexed contractId)",
  "function newETHContract(address _receiver, bytes32 _hashlock, uint256 _timelock, bytes32 _swapId, uint32 _destinationChain) external payable returns (bytes32)",
  "function newERC20Contract(address _receiver, address _token, uint256 _amount, bytes32 _hashlock, uint256 _timelock, bytes32 _swapId, uint32 _destinationChain) external returns (bytes32)",
  "function withdraw(bytes32 _contractId, bytes32 _preimage) external",
  "function refund(bytes32 _contractId) external",
  "function getContract(bytes32 _contractId) external view returns (tuple(address sender, address receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage, bytes32 swapId, uint32 destinationChain))",
];

const POLKADOT_CONTRACT_METADATA = {
  source: {
    hash: "0x...",
    language: "ink! 4.0.0",
    compiler: "rustc 1.68.0",
  },
  contract: {
    name: "fusion_htlc",
    version: "1.0.0",
  },
  spec: {
    constructors: [],
    docs: [],
    events: [
      {
        args: [
          {
            indexed: true,
            name: "contract_id",
            type: { displayName: ["Hash"], type: 1 },
          },
          {
            indexed: true,
            name: "sender",
            type: { displayName: ["AccountId"], type: 0 },
          },
          {
            indexed: true,
            name: "receiver",
            type: { displayName: ["AccountId"], type: 0 },
          },
          {
            indexed: false,
            name: "amount",
            type: { displayName: ["Balance"], type: 6 },
          },
          {
            indexed: false,
            name: "hashlock",
            type: { displayName: ["Hash"], type: 1 },
          },
          {
            indexed: false,
            name: "timelock",
            type: { displayName: ["BlockNumber"], type: 4 },
          },
          {
            indexed: false,
            name: "swap_id",
            type: { displayName: ["Hash"], type: 1 },
          },
        ],
        docs: [],
        label: "HTLCNew",
      },
    ],
    messages: [
      {
        args: [
          { name: "receiver", type: { displayName: ["AccountId"], type: 0 } },
          { name: "amount", type: { displayName: ["U256"], type: 7 } },
          { name: "hashlock", type: { displayName: ["Hash"], type: 1 } },
          { name: "timelock", type: { displayName: ["BlockNumber"], type: 4 } },
          { name: "swap_id", type: { displayName: ["Hash"], type: 1 } },
          { name: "source_chain", type: { displayName: ["u32"], type: 5 } },
        ],
        docs: [],
        label: "new_contract",
        mutates: true,
        payable: true,
        returnType: { displayName: ["Result"], type: 8 },
      },
    ],
  },
};

export interface EscrowContract {
  contractId: string;
  sender: string;
  receiver: string;
  token?: string;
  amount: string;
  hashlock: string;
  timelock: number;
  swapId: string;
  chain: "ethereum" | "polkadot";
  withdrawn: boolean;
  refunded: boolean;
  preimage?: string;
}

export interface CrossChainSwap {
  swapId: string;
  direction: "eth-to-dot" | "dot-to-eth";
  ethEscrow?: EscrowContract;
  dotEscrow?: EscrowContract;
  fusionOrder?: SwapOrder;
  status:
    | "initiated"
    | "escrowed"
    | "ready"
    | "completed"
    | "failed"
    | "refunded";
  secrets: string[];
  secretHashes: string[];
  createdAt: number;
  completedAt?: number;
}

export class BidirectionalRelayer extends EventEmitter {
  private ethProvider: ethers.JsonRpcProvider;
  private polkadotApi?: ApiPromise;
  private ethContract: ethers.Contract;
  private polkadotContract?: ContractPromise;
  private keyring: Keyring;
  private fusionSDK: FusionCrossChainSDK;

  private activeSwaps: Map<string, CrossChainSwap> = new Map();
  private isMonitoring = false;

  private config = {
    ethRpcUrl:
      process.env.ETH_RPC_URL ||
      "https://eth-sepolia.g.alchemy.com/v2/your-api-key",
    ethContractAddress: process.env.ETH_CONTRACT_ADDRESS || "0x...",
    polkadotWsUrl: POLKADOT_CONFIG.WSS_ENDPOINT,
    polkadotContractAddress: POLKADOT_CONFIG.RELAYER_CONTRACT_ADDRESS,
    privateKey: process.env.RELAYER_PRIVATE_KEY || "",
    polkadotSeed: process.env.POLKADOT_SEED || "//Alice",
    finalityBlocks: 12, // Ethereum finality blocks
    timelock: 3600, // 1 hour timelock
    polkadotTimelock: 1800, // 30 minutes (shorter for destination chain)
  };

  constructor(
    ethRpcUrl?: string,
    ethContractAddress?: string,
    fusionApiKey?: string
  ) {
    super();

    if (ethRpcUrl) this.config.ethRpcUrl = ethRpcUrl;
    if (ethContractAddress) this.config.ethContractAddress = ethContractAddress;

    this.ethProvider = new ethers.JsonRpcProvider(this.config.ethRpcUrl);
    this.ethContract = new ethers.Contract(
      this.config.ethContractAddress,
      EVM_RELAYER_ABI,
      this.ethProvider
    );

    this.keyring = new Keyring({ type: "sr25519" });

    this.fusionSDK = new FusionCrossChainSDK(
      "https://api.1inch.dev/fusion-plus",
      fusionApiKey,
      this.config.privateKey,
      this.config.ethRpcUrl
    );
  }

  /**
   * Initialize the relayer system
   */
  async initialize(): Promise<void> {
    try {
      console.log("Initializing Bidirectional Relayer...");

      await cryptoWaitReady();

      const wsProvider = new WsProvider(this.config.polkadotWsUrl);
      this.polkadotApi = await ApiPromise.create({ provider: wsProvider });

      this.polkadotContract = new ContractPromise(
        this.polkadotApi,
        POLKADOT_CONTRACT_METADATA,
        this.config.polkadotContractAddress
      );

      console.log("✅ Bidirectional Relayer initialized successfully");
      this.emit("initialized");
    } catch (error) {
      console.error("❌ Failed to initialize Bidirectional Relayer:", error);
      throw error;
    }
  }

  /**
   * Start monitoring both chains for swap events
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log("Relayer is already monitoring");
      return;
    }

    this.isMonitoring = true;
    console.log("🔍 Starting cross-chain event monitoring...");

    this.monitorEthereumEvents();

    await this.monitorPolkadotEvents();

    // Start periodic status checks
    this.startStatusChecks();

    this.emit("monitoring-started");
  }

  /**
   * Stop monitoring
   */
  async stopMonitoring(): Promise<void> {
    this.isMonitoring = false;
    console.log("⏹️ Stopped cross-chain monitoring");
    this.emit("monitoring-stopped");
  }

  /**
   * Create a new ETH → DOT swap
   */
  async createEthToDotSwap(
    ethAmount: string,
    ethSender: string,
    dotRecipient: string,
    secrets?: string[]
  ): Promise<CrossChainSwap> {
    try {
      console.log(`🔄 Creating ETH → DOT swap: ${ethAmount} ETH`);

      // Generate swap ID and secrets
      const swapId = ethers.keccak256(
        ethers.toUtf8Bytes(`${Date.now()}-${ethSender}-${dotRecipient}`)
      );
      const swapSecrets = secrets || [
        this.generateSecret(),
        this.generateSecret(),
      ];
      const secretHashes = swapSecrets.map((secret) =>
        ethers.keccak256(ethers.toUtf8Bytes(secret))
      );

      // Create Fusion+ order
      const fusionOrder = await this.fusionSDK.createEthToDotSwap(
        ethAmount,
        ethSender,
        dotRecipient
      );

      // Create cross-chain swap record
      const swap: CrossChainSwap = {
        swapId,
        direction: "eth-to-dot",
        fusionOrder,
        status: "initiated",
        secrets: swapSecrets,
        secretHashes: secretHashes.map((h) => h.toString()),
        createdAt: Date.now(),
      };

      this.activeSwaps.set(swapId, swap);

      console.log(`✅ ETH → DOT swap created with ID: ${swapId}`);
      this.emit("swap-created", swap);

      return swap;
    } catch (error) {
      console.error("❌ Failed to create ETH → DOT swap:", error);
      throw error;
    }
  }

  /**
   * Create a new DOT → ETH swap
   */
  async createDotToEthSwap(
    dotAmount: string,
    dotSender: string,
    ethRecipient: string,
    secrets?: string[]
  ): Promise<CrossChainSwap> {
    try {
      console.log(`🔄 Creating DOT → ETH swap: ${dotAmount} DOT`);

      // Generate swap ID and secrets
      const swapId = ethers.keccak256(
        ethers.toUtf8Bytes(`${Date.now()}-${dotSender}-${ethRecipient}`)
      );
      const swapSecrets = secrets || [
        this.generateSecret(),
        this.generateSecret(),
      ];
      const secretHashes = swapSecrets.map((secret) =>
        ethers.keccak256(ethers.toUtf8Bytes(secret))
      );

      // Create Fusion+ order
      const fusionOrder = await this.fusionSDK.createDotToEthSwap(
        dotAmount,
        dotSender,
        ethRecipient
      );

      // Create cross-chain swap record
      const swap: CrossChainSwap = {
        swapId,
        direction: "dot-to-eth",
        fusionOrder,
        status: "initiated",
        secrets: swapSecrets,
        secretHashes: secretHashes.map((h) => h.toString()),
        createdAt: Date.now(),
      };

      this.activeSwaps.set(swapId, swap);

      console.log(`✅ DOT → ETH swap created with ID: ${swapId}`);
      this.emit("swap-created", swap);

      return swap;
    } catch (error) {
      console.error("❌ Failed to create DOT → ETH swap:", error);
      throw error;
    }
  }

  /**
   * Execute bidirectional swap with proper escrow synchronization
   */
  async executeBidirectionalSwap(swap: CrossChainSwap): Promise<void> {
    try {
      console.log(`🚀 Executing bidirectional swap: ${swap.swapId}`);

      if (swap.direction === "eth-to-dot") {
        await this.executeEthToDotSwap(swap);
      } else {
        await this.executeDotToEthSwap(swap);
      }
    } catch (error) {
      console.error(`❌ Failed to execute swap ${swap.swapId}:`, error);
      swap.status = "failed";
      this.activeSwaps.set(swap.swapId, swap);
      this.emit("swap-failed", swap, error);
      throw error;
    }
  }

  /**
   * Execute ETH → DOT swap
   */
  private async executeEthToDotSwap(swap: CrossChainSwap): Promise<void> {
    // Step 1: Create ETH escrow
    const ethEscrow = await this.createEthEscrow(swap);
    swap.ethEscrow = ethEscrow;
    swap.status = "escrowed";
    this.activeSwaps.set(swap.swapId, swap);
    this.emit("escrow-created", swap, "ethereum");

    // Step 2: Wait for finality and create DOT escrow
    await this.waitForFinality("ethereum", ethEscrow.contractId);
    const dotEscrow = await this.createDotEscrow(swap);
    swap.dotEscrow = dotEscrow;
    this.activeSwaps.set(swap.swapId, swap);
    this.emit("escrow-created", swap, "polkadot");

    // Step 3: Wait for DOT finality
    await this.waitForFinality("polkadot", dotEscrow.contractId);
    swap.status = "ready";
    this.activeSwaps.set(swap.swapId, swap);
    this.emit("swap-ready", swap);

    // Step 4: Submit secrets to complete swap
    await this.completeSwap(swap);
  }

  /**
   * Execute DOT → ETH swap
   */
  private async executeDotToEthSwap(swap: CrossChainSwap): Promise<void> {
    // Step 1: Create DOT escrow
    const dotEscrow = await this.createDotEscrow(swap);
    swap.dotEscrow = dotEscrow;
    swap.status = "escrowed";
    this.activeSwaps.set(swap.swapId, swap);
    this.emit("escrow-created", swap, "polkadot");

    // Step 2: Wait for finality and create ETH escrow
    await this.waitForFinality("polkadot", dotEscrow.contractId);
    const ethEscrow = await this.createEthEscrow(swap);
    swap.ethEscrow = ethEscrow;
    this.activeSwaps.set(swap.swapId, swap);
    this.emit("escrow-created", swap, "ethereum");

    // Step 3: Wait for ETH finality
    await this.waitForFinality("ethereum", ethEscrow.contractId);
    swap.status = "ready";
    this.activeSwaps.set(swap.swapId, swap);
    this.emit("swap-ready", swap);

    // Step 4: Submit secrets to complete swap
    await this.completeSwap(swap);
  }

  /**
   * Create Ethereum escrow contract
   */
  private async createEthEscrow(swap: CrossChainSwap): Promise<EscrowContract> {
    if (!this.config.privateKey) {
      throw new Error("Private key not configured for Ethereum transactions");
    }

    const wallet = new ethers.Wallet(this.config.privateKey, this.ethProvider);
    const contractWithSigner = this.ethContract.connect(wallet);

    const timelock = Math.floor(Date.now() / 1000) + this.config.timelock;
    const hashlock = swap.secretHashes[0];

    // Determine if ETH or ERC20
    const isEth = swap.direction === "eth-to-dot";

    let tx: ethers.ContractTransactionResponse;
    let amount: string;

    if (isEth && swap.fusionOrder) {
      // ETH transfer
      amount = ethers.parseEther("0.1").toString(); // Example amount
      tx = await (contractWithSigner as any).newETHContract(
        swap.direction === "eth-to-dot" ? "0x..." : wallet.address, // receiver
        hashlock,
        timelock,
        swap.swapId,
        1000, // destination chain ID
        { value: amount }
      );
    } else {
      throw new Error("ERC20 escrow not implemented in this example");
    }

    const receipt = await tx.wait();
    const contractId =
      receipt?.logs?.[0]?.topics?.[1] ||
      ethers.keccak256(ethers.toUtf8Bytes(swap.swapId));

    return {
      contractId,
      sender: wallet.address,
      receiver: swap.direction === "eth-to-dot" ? "0x..." : wallet.address,
      amount,
      hashlock,
      timelock,
      swapId: swap.swapId,
      chain: "ethereum",
      withdrawn: false,
      refunded: false,
    };
  }

  /**
   * Create Polkadot escrow contract
   */
  private async createDotEscrow(swap: CrossChainSwap): Promise<EscrowContract> {
    if (!this.polkadotApi || !this.polkadotContract) {
      throw new Error("Polkadot API not initialized");
    }

    const keyPair = this.keyring.addFromUri(this.config.polkadotSeed);
    const timelock = await this.polkadotApi.query.system.number();
    const finalTimelock =
      (timelock as any).toNumber() + this.config.polkadotTimelock;

    const amount = "1000000000000"; // Example DOT amount (with decimals)
    const hashlock = swap.secretHashes[0];

    // Call the contract
    const tx = this.polkadotContract.tx.newContract(
      { gasLimit: -1, storageDepositLimit: null, value: amount },
      swap.direction === "dot-to-eth" ? keyPair.address : "5G...", // receiver
      amount,
      hashlock,
      finalTimelock,
      swap.swapId,
      1 // source chain ID
    );

    await new Promise((resolve, reject) => {
      tx.signAndSend(keyPair, (result: any) => {
        if (result.status.isInBlock) {
          resolve(result);
        } else if (result.status.isError) {
          reject(new Error("Transaction failed"));
        }
      });
    });

    return {
      contractId: ethers.keccak256(ethers.toUtf8Bytes(swap.swapId + "-dot")),
      sender: keyPair.address,
      receiver: swap.direction === "dot-to-eth" ? keyPair.address : "5G...",
      amount,
      hashlock,
      timelock: finalTimelock,
      swapId: swap.swapId,
      chain: "polkadot",
      withdrawn: false,
      refunded: false,
    };
  }

  /**
   * Wait for finality on specified chain
   */
  private async waitForFinality(
    chain: "ethereum" | "polkadot",
    contractId: string
  ): Promise<void> {
    console.log(
      `⏳ Waiting for finality on ${chain} for contract ${contractId}`
    );

    if (chain === "ethereum") {
      // Wait for specified number of blocks
      const currentBlock = await this.ethProvider.getBlockNumber();
      const targetBlock = currentBlock + this.config.finalityBlocks;

      while (true) {
        const latestBlock = await this.ethProvider.getBlockNumber();
        if (latestBlock >= targetBlock) break;
        await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds
      }
    } else {
      // For Polkadot, wait for a few blocks
      if (!this.polkadotApi) return;

      const currentBlock = await this.polkadotApi.query.system.number();
      const targetBlock = (currentBlock as any).toNumber() + 6; // 6 blocks for finality

      while (true) {
        const latestBlock = await this.polkadotApi.query.system.number();
        if ((latestBlock as any).toNumber() >= targetBlock) break;
        await new Promise((resolve) => setTimeout(resolve, 12000)); // Wait 12 seconds
      }
    }

    console.log(`✅ Finality reached on ${chain}`);
  }

  /**
   * Complete the swap by revealing secrets
   */
  private async completeSwap(swap: CrossChainSwap): Promise<void> {
    try {
      console.log(`🔓 Completing swap ${swap.swapId} by revealing secrets`);

      // Submit secret to Fusion+ if applicable
      if (swap.fusionOrder) {
        await this.fusionSDK.submitSecret(
          swap.fusionOrder.orderHash,
          swap.secrets[0]
        );
      }

      // Withdraw from both escrows using the secret
      await this.withdrawFromEscrows(swap);

      swap.status = "completed";
      swap.completedAt = Date.now();
      this.activeSwaps.set(swap.swapId, swap);

      console.log(`✅ Swap ${swap.swapId} completed successfully`);
      this.emit("swap-completed", swap);
    } catch (error) {
      console.error(`❌ Failed to complete swap ${swap.swapId}:`, error);
      throw error;
    }
  }

  /**
   * Withdraw from both escrow contracts
   */
  private async withdrawFromEscrows(swap: CrossChainSwap): Promise<void> {
    const secret = swap.secrets[0];

    // Withdraw from Ethereum escrow
    if (swap.ethEscrow && this.config.privateKey) {
      const wallet = new ethers.Wallet(
        this.config.privateKey,
        this.ethProvider
      );
      const contractWithSigner = this.ethContract.connect(wallet);

      const tx = await (contractWithSigner as any).withdraw(
        swap.ethEscrow.contractId,
        ethers.keccak256(ethers.toUtf8Bytes(secret))
      );
      await tx.wait();

      swap.ethEscrow.withdrawn = true;
      swap.ethEscrow.preimage = secret;
    }

    // Withdraw from Polkadot escrow
    if (swap.dotEscrow && this.polkadotContract) {
      const keyPair = this.keyring.addFromUri(this.config.polkadotSeed);

      const tx = this.polkadotContract.tx.withdraw(
        { gasLimit: -1, storageDepositLimit: null },
        swap.dotEscrow.contractId,
        secret
      );

      await new Promise((resolve, reject) => {
        tx.signAndSend(keyPair, (result: any) => {
          if (result.status.isInBlock) {
            resolve(result);
          } else if (result.status.isError) {
            reject(new Error("Withdrawal failed"));
          }
        });
      });

      swap.dotEscrow.withdrawn = true;
      swap.dotEscrow.preimage = secret;
    }
  }

  /**
   * Monitor Ethereum events
   */
  private monitorEthereumEvents(): void {
    this.ethContract.on(
      "HTLCNew",
      (
        contractId,
        sender,
        receiver,
        token,
        amount,
        hashlock,
        timelock,
        swapId
      ) => {
        console.log(`📡 Ethereum HTLC Created: ${contractId}`);
        this.emit("ethereum-htlc-created", {
          contractId,
          sender,
          receiver,
          token,
          amount: amount.toString(),
          hashlock,
          timelock: timelock.toNumber(),
          swapId,
        });
      }
    );

    this.ethContract.on("HTLCWithdraw", (contractId, secret) => {
      console.log(`🔓 Ethereum HTLC Withdrawn: ${contractId}`);
      this.emit("ethereum-htlc-withdrawn", { contractId, secret });
    });
  }

  /**
   * Monitor Polkadot events
   */
  private async monitorPolkadotEvents(): Promise<void> {
    if (!this.polkadotApi) return;

    this.polkadotApi.query.system.events((events: any) => {
      events.forEach((record: any) => {
        const { event } = record;

        if (
          event.section === "contracts" &&
          event.method === "ContractEmitted"
        ) {
          console.log(`📡 Polkadot Contract Event: ${event.data}`);
          this.emit("polkadot-contract-event", event.data);
        }
      });
    });
  }

  /**
   * Start periodic status checks
   */
  private startStatusChecks(): void {
    setInterval(async () => {
      if (!this.isMonitoring) return;

      for (const [swapId, swap] of this.activeSwaps) {
        try {
          await this.checkSwapStatus(swap);
        } catch (error) {
          console.error(`Error checking swap ${swapId}:`, error);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Check individual swap status
   */
  private async checkSwapStatus(swap: CrossChainSwap): Promise<void> {
    // Check if swap has timed out
    const now = Date.now();
    const timeoutMs = this.config.timelock * 1000;

    if (now - swap.createdAt > timeoutMs && swap.status !== "completed") {
      console.log(`⚠️ Swap ${swap.swapId} has timed out, initiating refund`);
      await this.refundSwap(swap);
    }

    // Check Fusion+ order status if applicable
    if (swap.fusionOrder && swap.status !== "completed") {
      try {
        const orderStatus = await this.fusionSDK.monitorOrderStatus(
          swap.fusionOrder.orderHash
        );
        console.log(
          `📊 Fusion+ order ${swap.fusionOrder.orderHash} status:`,
          orderStatus
        );
      } catch (error) {
        console.log(`Could not check Fusion+ order status:`, error);
      }
    }
  }

  /**
   * Refund a timed-out swap
   */
  private async refundSwap(swap: CrossChainSwap): Promise<void> {
    try {
      console.log(`🔄 Refunding swap ${swap.swapId}`);

      // Refund Ethereum escrow
      if (swap.ethEscrow && this.config.privateKey) {
        const wallet = new ethers.Wallet(
          this.config.privateKey,
          this.ethProvider
        );
        const contractWithSigner = this.ethContract.connect(wallet);

        const tx = await (contractWithSigner as any).refund(
          swap.ethEscrow.contractId
        );
        await tx.wait();

        swap.ethEscrow.refunded = true;
      }

      // Refund Polkadot escrow
      if (swap.dotEscrow && this.polkadotContract) {
        const keyPair = this.keyring.addFromUri(this.config.polkadotSeed);

        const tx = this.polkadotContract.tx.refund(
          { gasLimit: -1, storageDepositLimit: null },
          swap.dotEscrow.contractId
        );

        await new Promise((resolve, reject) => {
          tx.signAndSend(keyPair, (result: any) => {
            if (result.status.isInBlock) {
              resolve(result);
            } else if (result.status.isError) {
              reject(new Error("Refund failed"));
            }
          });
        });

        swap.dotEscrow.refunded = true;
      }

      swap.status = "refunded";
      this.activeSwaps.set(swap.swapId, swap);

      console.log(`✅ Swap ${swap.swapId} refunded successfully`);
      this.emit("swap-refunded", swap);
    } catch (error) {
      console.error(`❌ Failed to refund swap ${swap.swapId}:`, error);
      throw error;
    }
  }

  /**
   * Generate a random secret
   */
  private generateSecret(): string {
    return ethers.keccak256(ethers.toUtf8Bytes(Math.random().toString()));
  }

  /**
   * Get swap by ID
   */
  getSwap(swapId: string): CrossChainSwap | undefined {
    return this.activeSwaps.get(swapId);
  }

  /**
   * Get all active swaps
   */
  getAllSwaps(): CrossChainSwap[] {
    return Array.from(this.activeSwaps.values());
  }

  /**
   * Get swaps by status
   */
  getSwapsByStatus(status: CrossChainSwap["status"]): CrossChainSwap[] {
    return Array.from(this.activeSwaps.values()).filter(
      (swap) => swap.status === status
    );
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.stopMonitoring();

    if (this.polkadotApi) {
      await this.polkadotApi.disconnect();
    }

    this.removeAllListeners();
    console.log("🧹 Bidirectional Relayer cleanup completed");
  }
}

// Export singleton instance
export const bidirectionalRelayer = new BidirectionalRelayer();

// Export types and utilities
export { EVM_RELAYER_ABI, POLKADOT_CONTRACT_METADATA };
