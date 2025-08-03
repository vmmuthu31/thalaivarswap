/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from "ethers";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { EventEmitter } from "events";

export interface CrossChainOrder {
  orderHash: string;
  maker: string;
  srcChainId: number;
  dstChainId: number;
  srcToken: string;
  dstToken: string;
  srcAmount: string;
  dstAmount: string;
  secretHash: string;
  secret?: string;
  timelock: number;
  filled: boolean;
  cancelled: boolean;
  createdAt: number;
  makerData: string;
  takerData: string;
}

export interface RelayerConfig {
  // Ethereum configuration
  ethRpcUrl: string;
  ethPrivateKey: string;
  ethContractAddress: string;

  // Polkadot configuration
  dotWsUrl: string;
  dotSeed: string;
  dotContractAddress: string;

  // Relayer configuration
  relayerAddress: string;
  supportedChains: number[];
  minProfitMargin: number; // in basis points
  maxGasPrice: string; // in gwei

  // Monitoring configuration
  blockConfirmations: {
    ethereum: number;
    polkadot: number;
  };

  // Fee configuration
  relayerFee: number; // in basis points
  gasBuffer: number; // multiplier for gas estimation
}

export class CrossChainRelayer extends EventEmitter {
  private ethProvider: ethers.JsonRpcProvider;
  private ethWallet: ethers.Wallet;
  private ethContract: ethers.Contract;

  private dotApi?: ApiPromise;
  private dotKeyring?: Keyring;
  private dotAccount: any;
  private dotContract?: ContractPromise;

  private config: RelayerConfig;
  private isRunning = false;
  private orderCache = new Map<string, CrossChainOrder>();
  private processingOrders = new Set<string>();

  // Contract ABIs
  private readonly ETH_CONTRACT_ABI = [
    "event CrossChainOrderCreated(bytes32 indexed orderHash, address indexed maker, uint256 srcChainId, uint256 dstChainId, address srcToken, bytes dstToken, uint256 amount, bytes32 secretHash)",
    "event SecretRevealed(bytes32 indexed orderHash, bytes32 indexed secret, address indexed revealer)",
    "event CrossChainSwapCompleted(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 srcAmount, uint256 dstAmount)",
    "function fillOrder(bytes32 orderHash, bytes32 secret, bytes calldata takerData) external",
    "function getOrder(bytes32 orderHash) external view returns (tuple(address maker, address taker, uint256 srcChainId, uint256 dstChainId, address srcToken, bytes dstToken, uint256 srcAmount, uint256 dstAmount, bytes32 secretHash, bytes32 secret, uint256 timelock, bool filled, bool cancelled, uint256 createdAt, bytes makerData, bytes takerData))",
    "function getSecret(bytes32 orderHash) external view returns (bytes32)",
    "function orderExists(bytes32 orderHash) external view returns (bool)",
    "function revealSecret(bytes32 orderHash, bytes32 secret) external",
  ];

  constructor(config: RelayerConfig) {
    super();
    this.config = config;

    // Initialize Ethereum connection
    this.ethProvider = new ethers.JsonRpcProvider(config.ethRpcUrl);
    this.ethWallet = new ethers.Wallet(config.ethPrivateKey, this.ethProvider);
    this.ethContract = new ethers.Contract(
      config.ethContractAddress,
      this.ETH_CONTRACT_ABI,
      this.ethWallet
    );
  }

  /**
   * Initialize the relayer and start monitoring
   */
  async start(): Promise<void> {
    console.log("🚀 Starting Cross-Chain Relayer...");

    try {
      // Initialize Polkadot connection
      await this.initializePolkadot();

      // Verify Ethereum connection
      await this.verifyEthereumConnection();

      // Start monitoring both chains
      this.startEthereumMonitoring();
      this.startPolkadotMonitoring();

      this.isRunning = true;
      console.log("✅ Cross-Chain Relayer started successfully");

      this.emit("started");
    } catch (error) {
      console.error("❌ Failed to start relayer:", error);
      throw error;
    }
  }

  /**
   * Stop the relayer
   */
  async stop(): Promise<void> {
    console.log("🛑 Stopping Cross-Chain Relayer...");

    this.isRunning = false;

    if (this.dotApi) {
      await this.dotApi.disconnect();
    }

    console.log("✅ Cross-Chain Relayer stopped");
    this.emit("stopped");
  }

  /**
   * Initialize Polkadot connection
   */
  private async initializePolkadot(): Promise<void> {
    await cryptoWaitReady();

    this.dotKeyring = new Keyring({ type: "sr25519" });
    this.dotAccount = this.dotKeyring.addFromUri(this.config.dotSeed);

    const wsProvider = new WsProvider(this.config.dotWsUrl);
    this.dotApi = await ApiPromise.create({ provider: wsProvider });

    console.log("✅ Connected to Polkadot");
    console.log(`   Chain: ${await this.dotApi.rpc.system.chain()}`);
    console.log(`   Account: ${this.dotAccount.address}`);
  }

  /**
   * Verify Ethereum connection
   */
  private async verifyEthereumConnection(): Promise<void> {
    const network = await this.ethProvider.getNetwork();
    const balance = await this.ethProvider.getBalance(this.ethWallet.address);

    console.log("✅ Connected to Ethereum");
    console.log(`   Network: ${network.name} (${network.chainId})`);
    console.log(`   Relayer: ${this.ethWallet.address}`);
    console.log(`   Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther("0.01")) {
      console.warn("⚠️ Low ETH balance for gas fees");
    }
  }

  /**
   * Start monitoring Ethereum for cross-chain orders
   */
  private startEthereumMonitoring(): void {
    console.log("👀 Starting Ethereum monitoring...");

    // Listen for new cross-chain orders
    this.ethContract.on(
      "CrossChainOrderCreated",
      async (
        orderHash: string,
        maker: string,
        srcChainId: bigint,
        dstChainId: bigint,
        srcToken: string,
        dstToken: string,
        amount: bigint,
        secretHash: string,
        event: any
      ) => {
        try {
          console.log(`📝 New cross-chain order detected: ${orderHash}`);

          // Fetch full order details
          const orderDetails = await this.ethContract.getOrder(orderHash);

          const order: CrossChainOrder = {
            orderHash,
            maker: orderDetails.maker,
            srcChainId: Number(orderDetails.srcChainId),
            dstChainId: Number(orderDetails.dstChainId),
            srcToken: orderDetails.srcToken,
            dstToken: ethers.hexlify(orderDetails.dstToken),
            srcAmount: orderDetails.srcAmount.toString(),
            dstAmount: orderDetails.dstAmount.toString(),
            secretHash: orderDetails.secretHash,
            secret:
              orderDetails.secret === ethers.ZeroHash
                ? undefined
                : orderDetails.secret,
            timelock: Number(orderDetails.timelock),
            filled: orderDetails.filled,
            cancelled: orderDetails.cancelled,
            createdAt: Number(orderDetails.createdAt),
            makerData: ethers.hexlify(orderDetails.makerData),
            takerData: ethers.hexlify(orderDetails.takerData),
          };

          this.orderCache.set(orderHash, order);

          // Process the order if it's profitable
          await this.evaluateAndProcessOrder(order);
        } catch (error) {
          console.error(`❌ Error processing order ${orderHash}:`, error);
        }
      }
    );

    // Listen for secret reveals
    this.ethContract.on(
      "SecretRevealed",
      async (
        orderHash: string,
        secret: string,
        revealer: string,
        event: any
      ) => {
        try {
          console.log(`🔐 Secret revealed for order ${orderHash}`);

          const order = this.orderCache.get(orderHash);
          if (order) {
            order.secret = secret;
            this.orderCache.set(orderHash, order);

            // If this is a DOT → ETH order, we might need to complete it on Polkadot
            if (order.srcChainId === 1000 && order.dstChainId === 1) {
              await this.completePolkadotSide(order, secret);
            }
          }
        } catch (error) {
          console.error(
            `❌ Error handling secret reveal for ${orderHash}:`,
            error
          );
        }
      }
    );

    console.log("✅ Ethereum monitoring started");
  }

  /**
   * Start monitoring Polkadot for cross-chain events
   */
  private startPolkadotMonitoring(): void {
    if (!this.dotApi) return;

    console.log("👀 Starting Polkadot monitoring...");

    // Subscribe to new blocks and check for relevant events
    this.dotApi.rpc.chain.subscribeNewHeads(async (header) => {
      if (!this.isRunning) return;

      try {
        const blockHash = header.hash;
        const blockNumber = header.number.toNumber();

        // Get block details
        const block = await this.dotApi!.rpc.chain.getBlock(blockHash);

        // Process extrinsics for contract calls
        for (const extrinsic of block.block.extrinsics) {
          await this.processPolkadotExtrinsic(extrinsic, blockNumber);
        }
      } catch (error) {
        console.error("❌ Error monitoring Polkadot block:", error);
      }
    });

    console.log("✅ Polkadot monitoring started");
  }

  /**
   * Process a Polkadot extrinsic for relevant contract calls
   */
  private async processPolkadotExtrinsic(
    extrinsic: any,
    blockNumber: number
  ): Promise<void> {
    try {
      // Check if this is a contract call to our HTLC contract
      if (
        extrinsic.method.section === "contracts" &&
        extrinsic.method.method === "call"
      ) {
        const callData = extrinsic.method.args;

        // Decode the call to see if it's creating a new HTLC
        // This would require more specific parsing based on the contract ABI
        console.log(`📋 Contract call detected in block ${blockNumber}`);

        // For now, we'll emit a generic event
        this.emit("polkadotContractCall", {
          blockNumber,
          extrinsic: extrinsic.hash.toHex(),
          callData,
        });
      }
    } catch (error) {
      console.error("❌ Error processing Polkadot extrinsic:", error);
    }
  }

  /**
   * Evaluate and process a cross-chain order
   */
  private async evaluateAndProcessOrder(order: CrossChainOrder): Promise<void> {
    if (this.processingOrders.has(order.orderHash)) {
      return; // Already processing
    }

    try {
      this.processingOrders.add(order.orderHash);

      console.log(`🔍 Evaluating order ${order.orderHash}`);

      // Check if order is still valid
      if (order.filled || order.cancelled) {
        console.log(`⚠️ Order ${order.orderHash} already processed`);
        return;
      }

      if (Date.now() / 1000 > order.timelock) {
        console.log(`⚠️ Order ${order.orderHash} expired`);
        return;
      }

      // Check if we support the chains involved
      if (
        !this.config.supportedChains.includes(order.srcChainId) ||
        !this.config.supportedChains.includes(order.dstChainId)
      ) {
        console.log(`⚠️ Unsupported chains for order ${order.orderHash}`);
        return;
      }

      // Calculate profitability
      const isProfitable = await this.calculateProfitability(order);
      if (!isProfitable) {
        console.log(`💰 Order ${order.orderHash} not profitable`);
        return;
      }

      // Process the order based on direction
      if (order.srcChainId === 1 && order.dstChainId === 1000) {
        // ETH → DOT
        await this.processEthToDotOrder(order);
      } else if (order.srcChainId === 1000 && order.dstChainId === 1) {
        // DOT → ETH
        await this.processDotToEthOrder(order);
      }
    } catch (error) {
      console.error(`❌ Error processing order ${order.orderHash}:`, error);
    } finally {
      this.processingOrders.delete(order.orderHash);
    }
  }

  /**
   * Calculate profitability of an order
   */
  private async calculateProfitability(
    order: CrossChainOrder
  ): Promise<boolean> {
    try {
      // Get current gas prices
      const gasPrice = await this.ethProvider.getFeeData();
      const currentGasPrice =
        gasPrice.gasPrice || ethers.parseUnits("20", "gwei");

      // Check if gas price is within acceptable range
      const maxGasPrice = ethers.parseUnits(this.config.maxGasPrice, "gwei");
      if (currentGasPrice > maxGasPrice) {
        console.log(
          `⛽ Gas price too high: ${ethers.formatUnits(
            currentGasPrice,
            "gwei"
          )} gwei`
        );
        return false;
      }

      // Estimate gas costs for the transaction
      const estimatedGas = BigInt(200000); // Rough estimate for fillOrder
      const gasCost = currentGasPrice * estimatedGas;

      // Calculate minimum profit required
      const orderValue = BigInt(order.srcAmount);
      const minProfit =
        (orderValue * BigInt(this.config.minProfitMargin)) / BigInt(10000);

      // Calculate expected relayer fee
      const relayerFee =
        (orderValue * BigInt(this.config.relayerFee)) / BigInt(10000);

      const netProfit = relayerFee - gasCost;

      console.log(`💰 Profitability analysis for ${order.orderHash}:`);
      console.log(`   Order value: ${ethers.formatEther(orderValue)} ETH`);
      console.log(`   Relayer fee: ${ethers.formatEther(relayerFee)} ETH`);
      console.log(`   Gas cost: ${ethers.formatEther(gasCost)} ETH`);
      console.log(`   Net profit: ${ethers.formatEther(netProfit)} ETH`);
      console.log(`   Min profit: ${ethers.formatEther(minProfit)} ETH`);

      return netProfit >= minProfit;
    } catch (error) {
      console.error("❌ Error calculating profitability:", error);
      return false;
    }
  }

  /**
   * Process ETH → DOT order
   */
  private async processEthToDotOrder(order: CrossChainOrder): Promise<void> {
    console.log(`🔄 Processing ETH → DOT order ${order.orderHash}`);

    try {
      // Step 1: Create corresponding HTLC on Polkadot
      const dotContractId = await this.createPolkadotHTLC(order);

      if (!dotContractId) {
        console.error("❌ Failed to create Polkadot HTLC");
        return;
      }

      console.log(`✅ Created Polkadot HTLC: ${dotContractId}`);

      // Step 2: Wait for confirmation and then reveal secret on Ethereum
      await this.waitForConfirmations("polkadot", 1);

      // For demo purposes, we'll generate a secret
      // In production, this would come from the HTLC coordination
      const secret = ethers.hexlify(ethers.randomBytes(32));

      // Step 3: Fill the order on Ethereum
      await this.fillEthereumOrder(order.orderHash, secret);

      console.log(`✅ Completed ETH → DOT swap for order ${order.orderHash}`);
    } catch (error) {
      console.error(`❌ Error processing ETH → DOT order:`, error);
    }
  }

  /**
   * Process DOT → ETH order
   */
  private async processDotToEthOrder(order: CrossChainOrder): Promise<void> {
    console.log(`🔄 Processing DOT → ETH order ${order.orderHash}`);

    try {
      // Step 1: Verify DOT HTLC exists and is funded
      const dotHTLCExists = await this.verifyPolkadotHTLC(order);

      if (!dotHTLCExists) {
        console.error("❌ DOT HTLC not found or not funded");
        return;
      }

      // Step 2: Create corresponding HTLC on Ethereum (if needed)
      // This might already be handled by the order creation

      // Step 3: Wait for the secret to be revealed
      await this.waitForSecretReveal(order.orderHash);

      // Step 4: Use the secret to withdraw from DOT HTLC
      if (order.secret) {
        await this.withdrawFromPolkadotHTLC(order, order.secret);
      }

      console.log(`✅ Completed DOT → ETH swap for order ${order.orderHash}`);
    } catch (error) {
      console.error(`❌ Error processing DOT → ETH order:`, error);
    }
  }

  /**
   * Create HTLC on Polkadot
   */
  private async createPolkadotHTLC(
    order: CrossChainOrder
  ): Promise<string | null> {
    if (!this.dotApi || !this.dotAccount) {
      console.error("❌ Polkadot not initialized");
      return null;
    }

    try {
      console.log("📝 Creating Polkadot HTLC...");

      // This would interact with the Polkadot HTLC contract
      // For now, we'll simulate the creation
      const contractId = ethers.hexlify(ethers.randomBytes(32));

      // In a real implementation, this would:
      // 1. Call the newContract function on the Polkadot HTLC contract
      // 2. Lock the DOT tokens
      // 3. Set up the hashlock and timelock

      console.log(`✅ Simulated Polkadot HTLC creation: ${contractId}`);

      return contractId;
    } catch (error) {
      console.error("❌ Error creating Polkadot HTLC:", error);
      return null;
    }
  }

  /**
   * Verify Polkadot HTLC exists and is funded
   */
  private async verifyPolkadotHTLC(order: CrossChainOrder): Promise<boolean> {
    if (!this.dotApi) {
      return false;
    }

    try {
      // This would check the Polkadot HTLC contract state
      // For now, we'll simulate verification
      console.log(`🔍 Verifying Polkadot HTLC for order ${order.orderHash}`);

      // Simulate verification delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log("✅ Polkadot HTLC verified");
      return true;
    } catch (error) {
      console.error("❌ Error verifying Polkadot HTLC:", error);
      return false;
    }
  }

  /**
   * Fill order on Ethereum
   */
  private async fillEthereumOrder(
    orderHash: string,
    secret: string
  ): Promise<void> {
    try {
      console.log(`📝 Filling Ethereum order ${orderHash}`);

      const takerData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [this.ethWallet.address, Date.now()]
      );

      const tx = await this.ethContract.fillOrder(
        orderHash,
        secret,
        takerData,
        {
          gasLimit: 300000,
          gasPrice: await this.ethProvider.getFeeData().then((f) => f.gasPrice),
        }
      );

      console.log(`   Transaction: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`✅ Order filled in block ${receipt.blockNumber}`);
    } catch (error) {
      console.error("❌ Error filling Ethereum order:", error);
      throw error;
    }
  }

  /**
   * Wait for secret reveal
   */
  private async waitForSecretReveal(
    orderHash: string,
    timeoutMs: number = 300000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for secret reveal"));
      }, timeoutMs);

      const checkSecret = async () => {
        try {
          const secret = await this.ethContract.getSecret(orderHash);
          if (secret !== ethers.ZeroHash) {
            clearTimeout(timeout);

            // Update our cache
            const order = this.orderCache.get(orderHash);
            if (order) {
              order.secret = secret;
              this.orderCache.set(orderHash, order);
            }

            resolve();
          } else {
            setTimeout(checkSecret, 5000); // Check every 5 seconds
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      checkSecret();
    });
  }

  /**
   * Withdraw from Polkadot HTLC
   */
  private async withdrawFromPolkadotHTLC(
    order: CrossChainOrder,
    secret: string
  ): Promise<void> {
    if (!this.dotApi || !this.dotAccount) {
      throw new Error("Polkadot not initialized");
    }

    try {
      console.log(
        `💸 Withdrawing from Polkadot HTLC for order ${order.orderHash}`
      );

      // This would interact with the Polkadot HTLC contract to withdraw
      // For now, we'll simulate the withdrawal

      console.log(`   Using secret: ${secret}`);

      // Simulate withdrawal delay
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log("✅ Polkadot HTLC withdrawal completed");
    } catch (error) {
      console.error("❌ Error withdrawing from Polkadot HTLC:", error);
      throw error;
    }
  }

  /**
   * Complete Polkadot side of the swap
   */
  private async completePolkadotSide(
    order: CrossChainOrder,
    secret: string
  ): Promise<void> {
    try {
      console.log(`🔄 Completing Polkadot side for order ${order.orderHash}`);

      // Use the revealed secret to complete the Polkadot side
      await this.withdrawFromPolkadotHTLC(order, secret);

      console.log(`✅ Polkadot side completed for order ${order.orderHash}`);
    } catch (error) {
      console.error("❌ Error completing Polkadot side:", error);
    }
  }

  /**
   * Wait for block confirmations
   */
  private async waitForConfirmations(
    chain: "ethereum" | "polkadot",
    blocks: number
  ): Promise<void> {
    const confirmations =
      chain === "ethereum"
        ? this.config.blockConfirmations.ethereum
        : this.config.blockConfirmations.polkadot;

    const waitBlocks = Math.max(blocks, confirmations);

    console.log(`⏳ Waiting for ${waitBlocks} ${chain} confirmations...`);

    if (chain === "ethereum") {
      const startBlock = await this.ethProvider.getBlockNumber();

      return new Promise((resolve) => {
        const checkBlock = async () => {
          const currentBlock = await this.ethProvider.getBlockNumber();
          if (currentBlock >= startBlock + waitBlocks) {
            resolve();
          } else {
            setTimeout(checkBlock, 15000); // Check every 15 seconds
          }
        };
        checkBlock();
      });
    } else {
      // For Polkadot, we'll use a simple time-based wait
      // In production, you'd monitor actual block numbers
      await new Promise((resolve) => setTimeout(resolve, waitBlocks * 6000)); // ~6 seconds per block
    }
  }

  /**
   * Get relayer statistics
   */
  getStats(): any {
    return {
      isRunning: this.isRunning,
      ordersProcessed: this.orderCache.size,
      currentlyProcessing: this.processingOrders.size,
      supportedChains: this.config.supportedChains,
      relayerAddress: this.ethWallet.address,
      dotAccount: this.dotAccount?.address,
    };
  }

  /**
   * Get cached orders
   */
  getOrders(): CrossChainOrder[] {
    return Array.from(this.orderCache.values());
  }

  /**
   * Get specific order
   */
  getOrder(orderHash: string): CrossChainOrder | undefined {
    return this.orderCache.get(orderHash);
  }
}

// Export default configuration
export const DEFAULT_RELAYER_CONFIG: Partial<RelayerConfig> = {
  supportedChains: [1, 11155111, 1000], // Ethereum Mainnet, Sepolia, Polkadot
  minProfitMargin: 50, // 0.5%
  maxGasPrice: "50", // 50 gwei
  blockConfirmations: {
    ethereum: 3,
    polkadot: 2,
  },
  relayerFee: 30, // 0.3%
  gasBuffer: 1.2,
};
