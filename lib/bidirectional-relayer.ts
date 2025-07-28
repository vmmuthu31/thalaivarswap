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
    // Parse Polkadot contract events
    // This is simplified - you'll need to decode the actual event data
    console.log("📨 Polkadot contract event:", data.toString());

    // Example: Handle HTLCNew event
    // const decoded = this.polkadotContract.abi.decodeEvent(data);
    // Handle the event based on its type
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

  // 1inch Fusion+ API Integration
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

  // Dutch auction mechanism
  async participateInAuction(
    orderId: string,
    bidAmount: string
  ): Promise<void> {
    console.log(
      `💰 Participating in auction for order ${orderId} with bid ${bidAmount}`
    );

    // Implement competitive bidding logic
    // This would interact with 1inch Fusion+ auction system
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

      console.log("✅ Bid submitted successfully:", response.data);
    } catch (error) {
      console.error("❌ Failed to submit bid:", error);
    }
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
