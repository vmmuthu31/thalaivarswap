/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { ethers } from "ethers";
import { EventEmitter } from "events";
import axios from "axios";
import contractMetadata from "./polkadotrelayer.json";
// Types
interface HTLCContract {
  contractId: string;
  sender: string;
  receiver: string;
  amount: string;
  hashlock: string;
  timelock: number;
  swapId: string;
  sourceChain: number;
  destChain: number;
  destAmount: string;
  status: "pending" | "completed" | "refunded" | "expired";
}

interface SwapOrder {
  id: string;
  maker: string;
  taker?: string;
  sourceChain: number;
  destChain: number;
  sourceToken: string;
  destToken: string;
  sourceAmount: string;
  destAmount: string;
  secret: string;
  hashlock: string;
  timelock: number;
  status: "created" | "matched" | "executing" | "completed" | "failed";
}

export class CrossChainRelayer extends EventEmitter {
  private polkadotApi: ApiPromise | null = null;
  private ethereumProvider: ethers.Provider;
  private ethereumSigner: ethers.Wallet;
  private polkadotContract: ContractPromise | null = null;
  private ethereumContract: ethers.Contract;
  private keyring: Keyring;
  private polkadotAccount: any;

  // Configuration
  private config = {
    polkadot: {
      endpoint: "wss://rpc1.paseo.popnetwork.xyz",
      contractAddress: process.env.POLKADOT_CONTRACT_ADDRESS || "",
      seedPhrase: process.env.POLKADOT_SEED_PHRASE || "",
    },
    ethereum: {
      rpcUrl:
        process.env.ETHEREUM_RPC_URL || "https://sepolia.infura.io/v3/YOUR_KEY",
      contractAddress: process.env.ETHEREUM_CONTRACT_ADDRESS || "",
      privateKey: process.env.ETHEREUM_PRIVATE_KEY || "",
    },
    oneInch: {
      apiUrl: "https://api.1inch.dev/fusion-plus",
      apiKey: process.env.ONEINCH_API_KEY || "",
    },
  };

  // Active swaps tracking
  private activeSwaps = new Map<string, SwapOrder>();
  private pendingHTLCs = new Map<string, HTLCContract>();

  // Secret coordination
  private secretRegistry = new Map<
    string,
    {
      secret: string;
      hashlock: string;
      ethContractId?: string;
      dotContractId?: string;
      revealed: boolean;
      timestamp: number;
    }
  >();

  constructor() {
    super();

    // Initialize Ethereum
    this.ethereumProvider = new ethers.JsonRpcProvider(
      this.config.ethereum.rpcUrl
    );
    this.ethereumSigner = new ethers.Wallet(
      this.config.ethereum.privateKey,
      this.ethereumProvider
    );

    // Initialize Polkadot keyring
    this.keyring = new Keyring({ type: "sr25519" });
    this.polkadotAccount = this.keyring.addFromUri(
      this.config.polkadot.seedPhrase
    );

    // Ethereum contract ABI (simplified)
    const ethereumABI = [
      "event HTLCNew(bytes32 indexed contractId, address indexed sender, address indexed receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bytes32 swapId, uint32 sourceChain, uint32 destChain, uint256 destAmount, address relayer)",
      "event HTLCWithdraw(bytes32 indexed contractId, bytes32 indexed secret, address indexed relayer)",
      "event HTLCRefund(bytes32 indexed contractId)",
      "function newContract(address receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bytes32 swapId, uint32 sourceChain, uint32 destChain, uint256 destAmount) external payable returns (bytes32)",
      "function withdraw(bytes32 contractId, bytes32 preimage) external",
      "function registerRelayer(bytes32 contractId) external",
      "function getContract(bytes32 contractId) external view returns (tuple(address sender, address receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage, bytes32 swapId, uint32 sourceChain, uint32 destChain, uint256 destAmount, uint256 fee, address relayer))",
    ];

    this.ethereumContract = new ethers.Contract(
      this.config.ethereum.contractAddress,
      ethereumABI,
      this.ethereumSigner
    );
  }

  async initialize(): Promise<void> {
    console.log("🚀 Initializing Cross-Chain Relayer...");

    // Connect to Polkadot
    const wsProvider = new WsProvider(this.config.polkadot.endpoint);
    this.polkadotApi = await ApiPromise.create({ provider: wsProvider });

    // Load contract metadata (you'll need to provide this)
    this.polkadotContract = new ContractPromise(
      this.polkadotApi,
      contractMetadata,
      this.config.polkadot.contractAddress
    );

    // Start event listeners
    this.startPolkadotEventListener();
    this.startEthereumEventListener();

    // Start comprehensive monitoring
    await this.startMonitoring();

    console.log("✅ Relayer initialized successfully!");
  }

  private startPolkadotEventListener(): void {
    if (!this.polkadotContract || !this.polkadotApi) return;

    console.log("👂 Starting Polkadot event listener...");

    this.polkadotApi.query.system.events((events: any) => {
      events.forEach((record: any) => {
        const { event } = record;

        if (
          event.section === "contracts" &&
          event.method === "ContractEmitted"
        ) {
          const [contract, data] = event.data;

          if (contract.toString() === this.config.polkadot.contractAddress) {
            this.handlePolkadotContractEvent(data);
          }
        }
      });
    });
  }

  private startEthereumEventListener(): void {
    console.log("👂 Starting Ethereum event listener...");

    // Listen for new HTLC contracts
    this.ethereumContract.on("HTLCNew", (...args) => {
      const event = args[args.length - 1];
      this.handleEthereumHTLCNew(event);
    });

    // Listen for withdrawals
    this.ethereumContract.on("HTLCWithdraw", (...args) => {
      const event = args[args.length - 1];
      this.handleEthereumHTLCWithdraw(event);
    });

    // Listen for refunds
    this.ethereumContract.on("HTLCRefund", (...args) => {
      const event = args[args.length - 1];
      this.handleEthereumHTLCRefund(event);
    });
  }

  private handlePolkadotContractEvent(data: any): void {
    try {
      console.log("📨 Polkadot contract event:", data.toString());

      if (!this.polkadotContract) return;

      // Decode the event data using the contract ABI
      const decoded = this.polkadotContract.abi.decodeEvent(data);

      if (!decoded || !decoded.event) return;

      const eventName = decoded.event.identifier;
      const eventData = decoded.event.args;

      switch (eventName) {
        case "HTLCNew":
          this.handlePolkadotHTLCNew(eventData);
          break;
        case "HTLCWithdraw":
          this.handlePolkadotHTLCWithdraw(eventData);
          break;
        case "HTLCRefund":
          this.handlePolkadotHTLCRefund(eventData);
          break;
        case "RelayerRegistered":
          this.handlePolkadotRelayerRegistered(eventData);
          break;
        default:
          console.log(`Unknown Polkadot event: ${eventName}`);
      }
    } catch (error) {
      console.error("Error parsing Polkadot contract event:", error);
    }
  }

  private async handlePolkadotHTLCNew(eventData: any): Promise<void> {
    console.log("🆕 New Polkadot HTLC:", eventData);

    const contractId = eventData.contract_id;
    const sender = eventData.sender;
    const receiver = eventData.receiver;
    const amount = eventData.amount;
    const hashlock = eventData.hashlock;
    const timelock = eventData.timelock;
    const swapId = eventData.swap_id;
    const sourceChain = eventData.source_chain;
    const destChain = eventData.dest_chain;
    const destAmount = eventData.dest_amount;

    const htlc: HTLCContract = {
      contractId: contractId.toString(),
      sender: sender.toString(),
      receiver: receiver.toString(),
      amount: amount.toString(),
      hashlock: hashlock.toString(),
      timelock: parseInt(timelock.toString()),
      swapId: swapId.toString(),
      sourceChain: parseInt(sourceChain.toString()),
      destChain: parseInt(destChain.toString()),
      destAmount: destAmount.toString(),
      status: "pending",
    };

    this.pendingHTLCs.set(contractId.toString(), htlc);

    // If this is destined for Ethereum, create matching HTLC
    if (destChain === 1) {
      // Ethereum chain ID
      await this.createEthereumHTLC(htlc);
    }

    this.emit("polkadot-htlc-created", htlc);
  }

  private async handlePolkadotHTLCWithdraw(eventData: any): Promise<void> {
    console.log("💰 Polkadot HTLC withdrawn:", eventData);

    const contractId = eventData.contract_id.toString();
    const secret = eventData.secret.toString();

    // Use the revealed secret to complete Ethereum side
    const htlc = this.pendingHTLCs.get(contractId);
    if (htlc && htlc.destChain === 1) {
      await this.completeEthereumHTLC(contractId, secret);
    }

    this.emit("polkadot-htlc-withdrawn", { contractId, secret });
  }

  private handlePolkadotHTLCRefund(eventData: any): void {
    console.log("🔄 Polkadot HTLC refunded:", eventData);

    const contractId = eventData.contract_id.toString();
    const htlc = this.pendingHTLCs.get(contractId);
    if (htlc) {
      htlc.status = "refunded";
      this.pendingHTLCs.set(contractId, htlc);
    }

    this.emit("polkadot-htlc-refunded", { contractId });
  }

  private handlePolkadotRelayerRegistered(eventData: any): void {
    console.log("🔗 Polkadot relayer registered:", eventData);

    const contractId = eventData.contract_id.toString();
    const relayer = eventData.relayer.toString();

    this.emit("polkadot-relayer-registered", { contractId, relayer });
  }

  private async handleEthereumHTLCNew(event: ethers.Log): Promise<void> {
    console.log("🆕 New Ethereum HTLC:", event);

    const contractId = event.topics[1];
    const sender = event.topics[2];
    const receiver = event.topics[3];

    // Decode additional data from event
    const decoded = this.ethereumContract.interface.parseLog({
      topics: event.topics,
      data: event.data,
    });

    if (decoded) {
      const htlc: HTLCContract = {
        contractId: decoded.args.contractId,
        sender: decoded.args.sender,
        receiver: decoded.args.receiver,
        amount: decoded.args.amount.toString(),
        hashlock: decoded.args.hashlock,
        timelock: Number(decoded.args.timelock),
        swapId: decoded.args.swapId,
        sourceChain: decoded.args.sourceChain,
        destChain: decoded.args.destChain,
        destAmount: decoded.args.destAmount.toString(),
        status: "pending",
      };

      this.pendingHTLCs.set(contractId, htlc);

      // If this is destined for Polkadot, create matching HTLC
      if (decoded.args.destChain === 1002) {
        // Pop Network chain ID
        await this.createPolkadotHTLC(htlc);
      }
    }
  }

  private async handleEthereumHTLCWithdraw(event: ethers.Log): Promise<void> {
    console.log("💰 Ethereum HTLC withdrawn:", event);

    const contractId = event.topics[1];
    const secret = event.topics[2];

    // Use the revealed secret to complete Polkadot side
    const htlc = this.pendingHTLCs.get(contractId);
    if (htlc && htlc.destChain === 1002) {
      await this.completePolkadotHTLC(contractId, secret);
    }
  }

  private handleEthereumHTLCRefund(event: ethers.Log): void {
    console.log("🔄 Ethereum HTLC refunded:", event);

    const contractId = event.topics[1];
    const htlc = this.pendingHTLCs.get(contractId);
    if (htlc) {
      htlc.status = "refunded";
      this.pendingHTLCs.set(contractId, htlc);
    }
  }

  private async createPolkadotHTLC(ethHTLC: HTLCContract): Promise<void> {
    if (!this.polkadotContract || !this.polkadotApi) return;

    console.log("🔗 Creating matching Polkadot HTLC...");

    try {
      // Register as relayer first
      const registerTx = this.polkadotContract.tx.registerRelayer(
        { gasLimit: -1, storageDepositLimit: null },
        ethHTLC.contractId
      );

      await registerTx.signAndSend(this.polkadotAccount);

      // Create new HTLC on Polkadot with shorter timelock
      const shorterTimelock = ethHTLC.timelock - 3600; // 1 hour buffer

      const createTx = this.polkadotContract.tx.newContract(
        {
          gasLimit: -1,
          storageDepositLimit: null,
          value: ethHTLC.destAmount,
        },
        ethHTLC.receiver,
        ethHTLC.hashlock,
        shorterTimelock,
        ethHTLC.swapId,
        ethHTLC.sourceChain,
        ethHTLC.destChain,
        ethHTLC.amount
      );

      await createTx.signAndSend(this.polkadotAccount);

      console.log("✅ Polkadot HTLC created successfully");
    } catch (error) {
      console.error("❌ Failed to create Polkadot HTLC:", error);
    }
  }

  private async completePolkadotHTLC(
    contractId: string,
    secret: string
  ): Promise<void> {
    if (!this.polkadotContract) return;

    console.log("🎯 Completing Polkadot HTLC with revealed secret...");

    try {
      const withdrawTx = this.polkadotContract.tx.withdraw(
        { gasLimit: -1, storageDepositLimit: null },
        contractId,
        secret
      );

      await withdrawTx.signAndSend(this.polkadotAccount);

      console.log("✅ Polkadot HTLC completed successfully");
    } catch (error) {
      console.error("❌ Failed to complete Polkadot HTLC:", error);
    }
  }

  private async createEthereumHTLC(polkadotHTLC: HTLCContract): Promise<void> {
    console.log("🔗 Creating matching Ethereum HTLC...");

    try {
      // Register as relayer first
      const registerTx = await this.ethereumContract.registerRelayer(
        polkadotHTLC.contractId
      );
      await registerTx.wait();

      // Create new HTLC on Ethereum with shorter timelock
      const shorterTimelock = polkadotHTLC.timelock - 3600; // 1 hour buffer

      const createTx = await this.ethereumContract.newContract(
        polkadotHTLC.receiver,
        "0x0000000000000000000000000000000000000000", // ETH
        polkadotHTLC.destAmount,
        polkadotHTLC.hashlock,
        shorterTimelock,
        polkadotHTLC.swapId,
        polkadotHTLC.sourceChain,
        polkadotHTLC.destChain,
        polkadotHTLC.amount,
        { value: polkadotHTLC.destAmount }
      );

      await createTx.wait();

      console.log("✅ Ethereum HTLC created successfully");
    } catch (error) {
      console.error("❌ Failed to create Ethereum HTLC:", error);
    }
  }

  private async completeEthereumHTLC(
    contractId: string,
    secret: string
  ): Promise<void> {
    console.log("🎯 Completing Ethereum HTLC with revealed secret...");

    try {
      const withdrawTx = await this.ethereumContract.withdraw(
        contractId,
        secret
      );

      await withdrawTx.wait();

      console.log("✅ Ethereum HTLC completed successfully");
    } catch (error) {
      console.error("❌ Failed to complete Ethereum HTLC:", error);
    }
  }

  // Dutch auction mechanism for cross-chain swaps
  private auctionOrders = new Map<
    string,
    {
      orderId: string;
      startTime: number;
      startPrice: string;
      endPrice: string;
      duration: number;
      currentPrice: string;
      bids: Array<{
        resolver: string;
        price: string;
        timestamp: number;
        txHash?: string;
      }>;
      status: "active" | "filled" | "expired";
      swapDetails: {
        sourceChain: number;
        destChain: number;
        sourceToken: string;
        destToken: string;
        amount: string;
      };
    }
  >();

  /**
   * Create a Dutch auction for a cross-chain swap order
   */
  async createDutchAuction(
    swapId: string,
    startPrice: string,
    endPrice: string,
    duration: number,
    swapDetails: {
      sourceChain: number;
      destChain: number;
      sourceToken: string;
      destToken: string;
      amount: string;
    }
  ): Promise<void> {
    const orderId = `auction_${swapId}_${Date.now()}`;
    const startTime = Date.now();

    const auctionOrder = {
      orderId,
      startTime,
      startPrice,
      endPrice,
      duration,
      currentPrice: startPrice,
      bids: [],
      status: "active" as const,
      swapDetails,
    };

    this.auctionOrders.set(orderId, auctionOrder);

    console.log(`🏛️ Dutch auction created for swap ${swapId}:`, {
      orderId,
      startPrice,
      endPrice,
      duration: `${duration / 1000}s`,
    });

    // Start price decay mechanism
    this.startPriceDecay(orderId);

    // Broadcast to 1inch Fusion+ network
    await this.broadcastAuctionOrder(auctionOrder);

    this.emit("auction-created", { swapId, ...auctionOrder });
  }

  /**
   * Start the price decay mechanism for Dutch auction
   */
  private startPriceDecay(orderId: string): void {
    const auction = this.auctionOrders.get(orderId);
    if (!auction) return;

    const updateInterval = 1000; // Update every second
    const priceUpdateTimer = setInterval(() => {
      const currentAuction = this.auctionOrders.get(orderId);
      if (!currentAuction || currentAuction.status !== "active") {
        clearInterval(priceUpdateTimer);
        return;
      }

      const elapsed = Date.now() - currentAuction.startTime;
      const progress = Math.min(elapsed / currentAuction.duration, 1);

      if (progress >= 1) {
        // Auction expired
        currentAuction.status = "expired";
        this.auctionOrders.set(orderId, currentAuction);
        clearInterval(priceUpdateTimer);
        this.emit("auction-expired", { orderId });
        console.log(`⏰ Dutch auction expired: ${orderId}`);
        return;
      }

      // Calculate current price using linear decay
      const startPrice = parseFloat(currentAuction.startPrice);
      const endPrice = parseFloat(currentAuction.endPrice);
      const currentPrice = startPrice - (startPrice - endPrice) * progress;

      currentAuction.currentPrice = currentPrice.toString();
      this.auctionOrders.set(orderId, currentAuction);

      this.emit("auction-price-update", {
        orderId,
        currentPrice: currentPrice.toString(),
        progress,
      });
    }, updateInterval);
  }

  /**
   * Allow resolvers to participate in Dutch auction
   */
  async participateInDutchAuction(
    orderId: string,
    resolverAddress: string,
    bidPrice: string,
    maxGasPrice?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const auction = this.auctionOrders.get(orderId);
    if (!auction) {
      return { success: false, error: "Auction not found" };
    }

    if (auction.status !== "active") {
      return { success: false, error: "Auction is not active" };
    }

    const currentPrice = parseFloat(auction.currentPrice);
    const bidPriceNum = parseFloat(bidPrice);

    // Check if bid is acceptable (at or above current price)
    if (bidPriceNum < currentPrice) {
      return {
        success: false,
        error: `Bid too low. Current price: ${currentPrice}, bid: ${bidPriceNum}`,
      };
    }

    console.log(
      `💰 Resolver ${resolverAddress} participating in auction ${orderId} with bid ${bidPrice}`
    );

    try {
      // Execute the swap on behalf of the resolver
      const txHash = await this.executeSwapForResolver(
        auction,
        resolverAddress,
        bidPrice,
        maxGasPrice
      );

      // Record the successful bid
      const bid = {
        resolver: resolverAddress,
        price: bidPrice,
        timestamp: Date.now(),
        txHash,
      };

      auction.bids.push(bid);
      auction.status = "filled";
      this.auctionOrders.set(orderId, auction);

      console.log(`✅ Auction filled by resolver ${resolverAddress}`);
      this.emit("auction-filled", { orderId, resolver: resolverAddress, bid });

      return { success: true, txHash };
    } catch (error) {
      console.error(`❌ Failed to execute swap for resolver:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute swap on behalf of winning resolver
   */
  private async executeSwapForResolver(
    auction: any,
    resolverAddress: string,
    bidPrice: string,
    maxGasPrice?: string
  ): Promise<string> {
    const { swapDetails } = auction;

    // Create HTLC contracts based on swap direction
    if (swapDetails.sourceChain === 1 && swapDetails.destChain === 1000) {
      // ETH → DOT
      return await this.executeEthToDotForResolver(
        swapDetails,
        resolverAddress,
        bidPrice,
        maxGasPrice
      );
    } else if (
      swapDetails.sourceChain === 1000 &&
      swapDetails.destChain === 1
    ) {
      // DOT → ETH
      return await this.executeDotToEthForResolver(
        swapDetails,
        resolverAddress,
        bidPrice,
        maxGasPrice
      );
    } else {
      throw new Error("Unsupported swap direction");
    }
  }

  /**
   * Execute ETH → DOT swap for resolver
   */
  private async executeEthToDotForResolver(
    swapDetails: any,
    resolverAddress: string,
    bidPrice: string,
    maxGasPrice?: string
  ): Promise<string> {
    // Generate secret for HTLC
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(ethers.toUtf8Bytes(secret));
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    // Create Ethereum HTLC
    const gasOptions: any = { value: ethers.parseEther(swapDetails.amount) };
    if (maxGasPrice) {
      gasOptions.gasPrice = ethers.parseUnits(maxGasPrice, "gwei");
    }

    const ethTx = await this.ethereumContract.newContract(
      resolverAddress, // resolver will receive on Polkadot side
      "0x0000000000000000000000000000000000000000", // ETH
      ethers.parseEther(swapDetails.amount),
      hashlock,
      timelock,
      ethers.keccak256(ethers.toUtf8Bytes(`resolver_${Date.now()}`)), // swapId
      1, // Ethereum
      1000, // Polkadot
      ethers.parseEther(bidPrice), // dest amount based on bid
      gasOptions
    );

    const receipt = await ethTx.wait();
    console.log(`🔗 ETH HTLC created for resolver: ${receipt.hash}`);

    // Store secret for resolver to claim
    const contractId = receipt.logs[0].topics[1];
    await this.registerSecret(secret, hashlock, contractId);

    return receipt.hash;
  }

  /**
   * Execute DOT → ETH swap for resolver
   */
  private async executeDotToEthForResolver(
    swapDetails: any,
    resolverAddress: string,
    bidPrice: string,
    maxGasPrice?: string
  ): Promise<string> {
    if (!this.polkadotContract) {
      throw new Error("Polkadot contract not initialized");
    }

    // Generate secret for HTLC
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(ethers.toUtf8Bytes(secret));
    const timelock = 1000; // blocks

    // Create Polkadot HTLC
    const createTx = this.polkadotContract.tx.newContract(
      {
        gasLimit: -1,
        storageDepositLimit: null,
        value: swapDetails.amount,
      },
      resolverAddress,
      hashlock,
      timelock,
      ethers.keccak256(ethers.toUtf8Bytes(`resolver_${Date.now()}`)), // swapId
      1000, // Polkadot
      1, // Ethereum
      bidPrice
    );

    const result = await createTx.signAndSend(this.polkadotAccount);
    console.log(`🔗 DOT HTLC created for resolver: ${result.toString()}`);

    // Store secret for resolver to claim
    await this.registerSecret(secret, hashlock, result.toString());

    return result.toString();
  }

  /**
   * Get current auction status
   */
  getAuctionStatus(orderId: string): any | null {
    return this.auctionOrders.get(orderId) || null;
  }

  /**
   * Get all active auctions
   */
  getActiveAuctions(): Array<any> {
    return Array.from(this.auctionOrders.values()).filter(
      (auction) => auction.status === "active"
    );
  }

  /**
   * Broadcast auction order to 1inch Fusion+ network
   */
  private async broadcastAuctionOrder(auction: any): Promise<void> {
    try {
      const response = await axios.post(
        `${this.config.oneInch.apiUrl}/orders`,
        {
          order: {
            orderId: auction.orderId,
            type: "dutch_auction",
            startPrice: auction.startPrice,
            endPrice: auction.endPrice,
            duration: auction.duration,
            swapDetails: auction.swapDetails,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.oneInch.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        "📢 Dutch auction broadcasted to 1inch Fusion+:",
        response.data
      );
    } catch (error) {
      console.error("❌ Failed to broadcast auction order:", error);
    }
  }

  // Legacy 1inch Fusion+ API Integration (kept for compatibility)
  async broadcastOrder(order: SwapOrder): Promise<void> {
    try {
      const response = await axios.post(
        `${this.config.oneInch.apiUrl}/orders`,
        {
          order: {
            maker: order.maker,
            sourceChain: order.sourceChain,
            destChain: order.destChain,
            sourceToken: order.sourceToken,
            destToken: order.destToken,
            sourceAmount: order.sourceAmount,
            destAmount: order.destAmount,
            hashlock: order.hashlock,
            timelock: order.timelock,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.oneInch.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📢 Order broadcasted to 1inch Fusion+:", response.data);
    } catch (error) {
      console.error("❌ Failed to broadcast order:", error);
    }
  }

  async getActiveOrders(): Promise<SwapOrder[]> {
    try {
      const response = await axios.get(
        `${this.config.oneInch.apiUrl}/orders/active`,
        {
          headers: {
            Authorization: `Bearer ${this.config.oneInch.apiKey}`,
          },
        }
      );

      return response.data.orders || [];
    } catch (error) {
      console.error("❌ Failed to fetch active orders:", error);
      return [];
    }
  }

  // Legacy auction participation (kept for compatibility)
  async participateInAuction(
    orderId: string,
    bidAmount: string
  ): Promise<void> {
    console.log(
      `💰 Participating in legacy auction for order ${orderId} with bid ${bidAmount}`
    );

    try {
      const response = await axios.post(
        `${this.config.oneInch.apiUrl}/orders/${orderId}/bid`,
        { amount: bidAmount },
        {
          headers: {
            Authorization: `Bearer ${this.config.oneInch.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ Legacy bid submitted successfully:", response.data);
    } catch (error) {
      console.error("❌ Failed to submit legacy bid:", error);
    }
  }

  // Secret coordination methods
  async registerSecret(
    secret: string,
    hashlock: string,
    swapId: string
  ): Promise<void> {
    console.log(`🔐 Registering secret for swap: ${swapId}`);

    this.secretRegistry.set(swapId, {
      secret,
      hashlock,
      revealed: false,
      timestamp: Date.now(),
    });
  }

  async linkContracts(
    swapId: string,
    ethContractId?: string,
    dotContractId?: string
  ): Promise<void> {
    const secretInfo = this.secretRegistry.get(swapId);
    if (secretInfo) {
      secretInfo.ethContractId = ethContractId;
      secretInfo.dotContractId = dotContractId;
      this.secretRegistry.set(swapId, secretInfo);

      console.log(
        `🔗 Linked contracts for swap ${swapId}: ETH=${ethContractId}, DOT=${dotContractId}`
      );
    }
  }

  async revealSecret(
    swapId: string,
    contractId: string
  ): Promise<string | null> {
    const secretInfo = this.secretRegistry.get(swapId);
    if (!secretInfo) {
      console.error(`❌ No secret found for swap: ${swapId}`);
      return null;
    }

    if (secretInfo.revealed) {
      console.log(`🔓 Secret already revealed for swap: ${swapId}`);
      return secretInfo.secret;
    }

    // Mark as revealed
    secretInfo.revealed = true;
    secretInfo.timestamp = Date.now();
    this.secretRegistry.set(swapId, secretInfo);

    console.log(`🔓 Secret revealed for swap: ${swapId}`);
    this.emit("secret-revealed", {
      swapId,
      contractId,
      secret: secretInfo.secret,
    });

    return secretInfo.secret;
  }

  async coordinateSecretReveal(swapId: string): Promise<void> {
    const secretInfo = this.secretRegistry.get(swapId);
    if (!secretInfo) {
      console.error(`❌ No secret coordination info for swap: ${swapId}`);
      return;
    }

    console.log(`🤝 Coordinating secret reveal for swap: ${swapId}`);

    // Wait for both contracts to be ready
    if (!secretInfo.ethContractId || !secretInfo.dotContractId) {
      console.log(
        `⏳ Waiting for both contracts to be linked for swap: ${swapId}`
      );
      return;
    }

    // Reveal secret to complete both sides
    if (!secretInfo.revealed) {
      const secret = await this.revealSecret(swapId, secretInfo.ethContractId);

      if (secret) {
        // Complete both HTLCs
        await Promise.all([
          this.completeEthereumHTLC(secretInfo.ethContractId, secret),
          this.completePolkadotHTLC(secretInfo.dotContractId, secret),
        ]);
      }
    }
  }

  // Cross-chain swap orchestration
  async createEthToDotSwap(
    ethAmount: string,
    ethSender: string,
    dotRecipient: string
  ): Promise<{ swapId: string; secret: string; hashlock: string }> {
    console.log(`🔄 Creating ETH → DOT swap: ${ethAmount} ETH`);

    // Generate secret and hashlock
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(ethers.toUtf8Bytes(secret));
    const swapId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "string", "string", "uint256"],
        [ethSender, dotRecipient, ethAmount, Date.now()]
      )
    );

    // Register the secret
    await this.registerSecret(secret, hashlock, swapId);

    // Create Ethereum HTLC first
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    try {
      const ethTx = await this.ethereumContract.newContract(
        dotRecipient, // receiver will be updated to actual DOT address
        "0x0000000000000000000000000000000000000000", // ETH
        ethers.parseEther(ethAmount),
        hashlock,
        timelock,
        swapId,
        1, // Ethereum
        1000, // Polkadot parachain
        ethers.parseEther(ethAmount),
        { value: ethers.parseEther(ethAmount) }
      );

      const receipt = await ethTx.wait();
      const ethContractId = receipt.logs[0].topics[1]; // Get contract ID from event

      await this.linkContracts(swapId, ethContractId);

      this.emit("eth-to-dot-swap-created", {
        swapId,
        ethContractId,
        ethAmount,
        dotRecipient,
      });

      return { swapId, secret, hashlock };
    } catch (error) {
      console.error("❌ Failed to create ETH → DOT swap:", error);
      throw error;
    }
  }

  async createDotToEthSwap(
    dotAmount: string,
    dotSender: string,
    ethRecipient: string
  ): Promise<{ swapId: string; secret: string; hashlock: string }> {
    console.log(`🔄 Creating DOT → ETH swap: ${dotAmount} DOT`);

    // Generate secret and hashlock
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(ethers.toUtf8Bytes(secret));
    const swapId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "string", "string", "uint256"],
        [dotSender, ethRecipient, dotAmount, Date.now()]
      )
    );

    // Register the secret
    await this.registerSecret(secret, hashlock, swapId);

    // Create Polkadot HTLC first
    if (!this.polkadotContract) {
      throw new Error("Polkadot contract not initialized");
    }

    try {
      const timelock = 1000; // blocks
      const createTx = this.polkadotContract.tx.newContract(
        {
          gasLimit: -1,
          storageDepositLimit: null,
          value: dotAmount,
        },
        ethRecipient,
        hashlock,
        timelock,
        swapId,
        1000, // Polkadot parachain
        1, // Ethereum
        dotAmount
      );

      const result = await createTx.signAndSend(this.polkadotAccount);
      const dotContractId = result.toString(); // Simplified - you'd extract from events

      await this.linkContracts(swapId, undefined, dotContractId);

      this.emit("dot-to-eth-swap-created", {
        swapId,
        dotContractId,
        dotAmount,
        ethRecipient,
      });

      return { swapId, secret, hashlock };
    } catch (error) {
      console.error("❌ Failed to create DOT → ETH swap:", error);
      throw error;
    }
  }

  // Cross-chain monitoring and status synchronization
  private monitoringState = {
    isMonitoring: false,
    lastEthBlock: 0,
    lastDotBlock: 0,
    syncStatus: {
      ethereum: { synced: false, blockHeight: 0, lastUpdate: 0 },
      polkadot: { synced: false, blockHeight: 0, lastUpdate: 0 },
    },
    metrics: {
      totalSwaps: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      avgSwapTime: 0,
      activeHTLCs: 0,
    },
  };

  private swapMetrics = new Map<
    string,
    {
      swapId: string;
      startTime: number;
      endTime?: number;
      status: string;
      direction: "eth-to-dot" | "dot-to-eth";
      ethTxHash?: string;
      dotTxHash?: string;
      errorCount: number;
      lastError?: string;
    }
  >();

  /**
   * Start comprehensive cross-chain monitoring
   */
  async startMonitoring(): Promise<void> {
    if (this.monitoringState.isMonitoring) {
      console.log("⚠️ Monitoring already active");
      return;
    }

    console.log("🔍 Starting comprehensive cross-chain monitoring...");
    this.monitoringState.isMonitoring = true;

    // Start block synchronization monitoring
    this.startBlockSyncMonitoring();

    // Start HTLC status monitoring
    this.startHTLCStatusMonitoring();

    // Start metrics collection
    this.startMetricsCollection();

    // Start health monitoring
    this.startHealthMonitoring();

    console.log("✅ Cross-chain monitoring started successfully");
    this.emit("monitoring-started");
  }

  /**
   * Stop monitoring
   */
  async stopMonitoring(): Promise<void> {
    console.log("🛑 Stopping cross-chain monitoring...");
    this.monitoringState.isMonitoring = false;
    this.emit("monitoring-stopped");
  }

  /**
   * Monitor block synchronization across chains
   */
  private startBlockSyncMonitoring(): void {
    const syncInterval = 5000; // Check every 5 seconds

    const monitorSync = async () => {
      if (!this.monitoringState.isMonitoring) return;

      try {
        // Monitor Ethereum blocks
        if (this.ethereumProvider) {
          const ethBlockNumber = await this.ethereumProvider.getBlockNumber();
          const ethSyncStatus = this.monitoringState.syncStatus.ethereum;

          ethSyncStatus.blockHeight = ethBlockNumber;
          ethSyncStatus.synced =
            ethBlockNumber > this.monitoringState.lastEthBlock;
          ethSyncStatus.lastUpdate = Date.now();
          this.monitoringState.lastEthBlock = ethBlockNumber;

          this.emit("eth-block-update", {
            blockNumber: ethBlockNumber,
            synced: ethSyncStatus.synced,
          });
        }

        // Monitor Polkadot blocks
        if (this.polkadotApi?.isConnected) {
          const header = await this.polkadotApi.rpc.chain.getHeader();
          const dotBlockNumber = header.number.toNumber();
          const dotSyncStatus = this.monitoringState.syncStatus.polkadot;

          dotSyncStatus.blockHeight = dotBlockNumber;
          dotSyncStatus.synced =
            dotBlockNumber > this.monitoringState.lastDotBlock;
          dotSyncStatus.lastUpdate = Date.now();
          this.monitoringState.lastDotBlock = dotBlockNumber;

          this.emit("dot-block-update", {
            blockNumber: dotBlockNumber,
            synced: dotSyncStatus.synced,
          });
        }
      } catch (error) {
        console.error("❌ Block sync monitoring error:", error);
        this.emit("sync-error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      setTimeout(monitorSync, syncInterval);
    };

    monitorSync();
  }

  /**
   * Monitor HTLC contract statuses
   */
  private startHTLCStatusMonitoring(): void {
    const statusInterval = 10000; // Check every 10 seconds

    const monitorHTLCs = async () => {
      if (!this.monitoringState.isMonitoring) return;

      try {
        let activeCount = 0;

        // Monitor all pending HTLCs
        for (const [contractId, htlc] of this.pendingHTLCs.entries()) {
          if (htlc.status === "pending") {
            activeCount++;

            // Check if HTLC has expired
            const currentTime = Math.floor(Date.now() / 1000);
            if (currentTime > htlc.timelock) {
              htlc.status = "expired";
              this.pendingHTLCs.set(contractId, htlc);
              this.emit("htlc-expired", { contractId, htlc });
              console.log(`⏰ HTLC expired: ${contractId}`);
            }
          }
        }

        this.monitoringState.metrics.activeHTLCs = activeCount;
        this.emit("htlc-status-update", { activeHTLCs: activeCount });
      } catch (error) {
        console.error("❌ HTLC status monitoring error:", error);
      }

      setTimeout(monitorHTLCs, statusInterval);
    };

    monitorHTLCs();
  }

  /**
   * Collect and update metrics
   */
  private startMetricsCollection(): void {
    const metricsInterval = 30000; // Update every 30 seconds

    const collectMetrics = () => {
      if (!this.monitoringState.isMonitoring) return;

      try {
        const metrics = this.monitoringState.metrics;

        // Calculate average swap time
        const completedSwaps = Array.from(this.swapMetrics.values()).filter(
          (swap) => swap.endTime && swap.status === "completed"
        );

        if (completedSwaps.length > 0) {
          const totalTime = completedSwaps.reduce(
            (sum, swap) => sum + (swap.endTime! - swap.startTime),
            0
          );
          metrics.avgSwapTime = totalTime / completedSwaps.length;
        }

        metrics.totalSwaps = this.swapMetrics.size;
        metrics.successfulSwaps = Array.from(this.swapMetrics.values()).filter(
          (swap) => swap.status === "completed"
        ).length;
        metrics.failedSwaps = Array.from(this.swapMetrics.values()).filter(
          (swap) => swap.status === "failed"
        ).length;

        this.emit("metrics-update", { ...metrics });
      } catch (error) {
        console.error("❌ Metrics collection error:", error);
      }

      setTimeout(collectMetrics, metricsInterval);
    };

    collectMetrics();
  }

  /**
   * Monitor system health
   */
  private startHealthMonitoring(): void {
    const healthInterval = 15000; // Check every 15 seconds

    const monitorHealth = async () => {
      if (!this.monitoringState.isMonitoring) return;

      try {
        const health = await this.healthCheck();

        // Check for issues
        const issues: string[] = [];
        if (!health.polkadot) issues.push("Polkadot connection lost");
        if (!health.ethereum) issues.push("Ethereum connection lost");

        // Check block sync lag
        const now = Date.now();
        const ethSyncAge =
          now - this.monitoringState.syncStatus.ethereum.lastUpdate;
        const dotSyncAge =
          now - this.monitoringState.syncStatus.polkadot.lastUpdate;

        if (ethSyncAge > 30000) issues.push("Ethereum sync lag detected");
        if (dotSyncAge > 30000) issues.push("Polkadot sync lag detected");

        this.emit("health-check", {
          ...health,
          issues,
          syncStatus: this.monitoringState.syncStatus,
        });

        if (issues.length > 0) {
          console.warn("⚠️ Health issues detected:", issues);
        }
      } catch (error) {
        console.error("❌ Health monitoring error:", error);
      }

      setTimeout(monitorHealth, healthInterval);
    };

    monitorHealth();
  }

  /**
   * Track swap lifecycle
   */
  trackSwap(
    swapId: string,
    direction: "eth-to-dot" | "dot-to-eth",
    ethTxHash?: string,
    dotTxHash?: string
  ): void {
    const existing = this.swapMetrics.get(swapId);

    if (!existing) {
      this.swapMetrics.set(swapId, {
        swapId,
        startTime: Date.now(),
        status: "initiated",
        direction,
        ethTxHash,
        dotTxHash,
        errorCount: 0,
      });
    } else {
      if (ethTxHash) existing.ethTxHash = ethTxHash;
      if (dotTxHash) existing.dotTxHash = dotTxHash;
      this.swapMetrics.set(swapId, existing);
    }

    this.emit("swap-tracked", { swapId, direction });
  }

  /**
   * Update swap status
   */
  updateSwapStatus(swapId: string, status: string, error?: string): void {
    const swap = this.swapMetrics.get(swapId);
    if (!swap) return;

    swap.status = status;
    if (status === "completed" || status === "failed") {
      swap.endTime = Date.now();
    }

    if (error) {
      swap.errorCount++;
      swap.lastError = error;
    }

    this.swapMetrics.set(swapId, swap);
    this.emit("swap-status-updated", { swapId, status, error });
  }

  /**
   * Get comprehensive monitoring status
   */
  getMonitoringStatus(): {
    isMonitoring: boolean;
    syncStatus: any;
    metrics: any;
    activeSwaps: number;
    recentErrors: string[];
  } {
    const recentErrors = Array.from(this.swapMetrics.values())
      .filter((swap) => swap.lastError && Date.now() - swap.startTime < 3600000) // Last hour
      .map((swap) => swap.lastError!)
      .slice(0, 10); // Last 10 errors

    return {
      isMonitoring: this.monitoringState.isMonitoring,
      syncStatus: this.monitoringState.syncStatus,
      metrics: this.monitoringState.metrics,
      activeSwaps: Array.from(this.swapMetrics.values()).filter(
        (swap) => !swap.endTime
      ).length,
      recentErrors,
    };
  }

  /**
   * Get swap analytics
   */
  getSwapAnalytics(): {
    totalSwaps: number;
    successRate: number;
    avgSwapTime: number;
    swapsByDirection: { ethToDot: number; dotToEth: number };
    hourlyVolume: Array<{ hour: number; count: number }>;
  } {
    const swaps = Array.from(this.swapMetrics.values());
    const now = Date.now();
    const oneHour = 3600000;

    // Group by hour for last 24 hours
    const hourlyVolume = Array.from({ length: 24 }, (_, i) => {
      const hourStart = now - (i + 1) * oneHour;
      const hourEnd = now - i * oneHour;

      return {
        hour: 23 - i,
        count: swaps.filter(
          (swap) => swap.startTime >= hourStart && swap.startTime < hourEnd
        ).length,
      };
    });

    return {
      totalSwaps: swaps.length,
      successRate:
        swaps.length > 0
          ? (swaps.filter((s) => s.status === "completed").length /
              swaps.length) *
            100
          : 0,
      avgSwapTime: this.monitoringState.metrics.avgSwapTime,
      swapsByDirection: {
        ethToDot: swaps.filter((s) => s.direction === "eth-to-dot").length,
        dotToEth: swaps.filter((s) => s.direction === "dot-to-eth").length,
      },
      hourlyVolume,
    };
  }

  // Health check and monitoring
  async healthCheck(): Promise<{ polkadot: boolean; ethereum: boolean }> {
    const polkadotHealthy = this.polkadotApi?.isConnected || false;
    const ethereumHealthy = await this.ethereumProvider
      .getNetwork()
      .then(() => true)
      .catch(() => false);

    return {
      polkadot: polkadotHealthy,
      ethereum: ethereumHealthy,
    };
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    console.log("🛑 Shutting down relayer...");

    // Stop monitoring
    await this.stopMonitoring();

    if (this.polkadotApi) {
      await this.polkadotApi.disconnect();
    }

    this.ethereumContract.removeAllListeners();

    console.log("✅ Relayer shutdown complete");
  }
}

// Usage example
async function main() {
  const relayer = new CrossChainRelayer();

  try {
    await relayer.initialize();

    // Health check every 30 seconds
    setInterval(async () => {
      const health = await relayer.healthCheck();
      console.log("🏥 Health check:", health);
    }, 30000);

    // Graceful shutdown handling
    process.on("SIGINT", async () => {
      await relayer.shutdown();
      process.exit(0);
    });

    console.log("🎉 Relayer is running!");
  } catch (error) {
    console.error("💥 Failed to start relayer:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
