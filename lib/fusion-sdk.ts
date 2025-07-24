/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  SDK,
  NetworkEnum,
  QuoteParams,
  OrderParams,
  HashLock,
  SupportedChain,
} from "@1inch/cross-chain-sdk";
import { PrivateKeyProviderConnector } from "@1inch/fusion-sdk";
import { ethers } from "ethers";
import { randomBytes } from "crypto";

export const SUPPORTED_NETWORKS = {
  ETHEREUM: NetworkEnum.ETHEREUM,
  GNOSIS: NetworkEnum.GNOSIS,
  POLYGON: NetworkEnum.POLYGON,
  ARBITRUM: NetworkEnum.ARBITRUM,
  OPTIMISM: NetworkEnum.OPTIMISM,
  AVALANCHE: NetworkEnum.AVALANCHE,
  FANTOM: NetworkEnum.FANTOM,
  BSC: NetworkEnum.BINANCE,
  XDAI: NetworkEnum.GNOSIS,
  BASE: NetworkEnum.COINBASE,
};

export const POLKADOT_CONFIG = {
  ROCOCO_PARACHAIN_ID: 1000,
  WSS_ENDPOINT: "wss://rococo-rpc.polkadot.io",
  RELAYER_CONTRACT_ADDRESS: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
};

export interface CrossChainSwapParams {
  srcChainId: SupportedChain;
  dstChainId: SupportedChain;
  srcTokenAddress: string;
  dstTokenAddress: string;
  amount: string;
  walletAddress: string;
  slippage?: number;
  enableEstimate?: boolean;
}

export interface SwapOrder {
  orderHash: string;
  secrets: string[];
  secretHashes: string[];
  hashLock: HashLock;
  srcEscrowId?: string;
  dstEscrowId?: string;
  status: "created" | "escrowed" | "ready" | "completed" | "failed";
}

export class FusionCrossChainSDK {
  private sdk: SDK;
  private blockchainProvider?: PrivateKeyProviderConnector;

  constructor(
    apiUrl: string = "https://api.1inch.dev/fusion-plus",
    authKey?: string,
    privateKey?: string,
    nodeUrl?: string
  ) {
    // Initialize blockchain provider if private key is provided
    if (privateKey && nodeUrl) {
      const provider = new ethers.JsonRpcProvider(nodeUrl);
      this.blockchainProvider = new PrivateKeyProviderConnector(
        privateKey,
        provider as any
      );
    }

    this.sdk = new SDK({
      url: apiUrl,
      authKey,
      blockchainProvider: this.blockchainProvider,
    });
  }

  /**
   * Get quote for cross-chain swap (ETH → DOT or DOT → ETH)
   */
  async getSwapQuote(params: CrossChainSwapParams) {
    try {
      const quoteParams: QuoteParams = {
        srcChainId: params.srcChainId,
        dstChainId: params.dstChainId,
        srcTokenAddress: params.srcTokenAddress,
        dstTokenAddress: params.dstTokenAddress,
        amount: params.amount,
        walletAddress: params.walletAddress,
        enableEstimate: params.enableEstimate || true,
      };

      const quote = await this.sdk.getQuote(quoteParams);
      return quote;
    } catch (error) {
      console.error("Error getting cross-chain quote:", error);
      throw error;
    }
  }

  /**
   * Create a new cross-chain swap order with proper secret management
   */
  async createSwapOrder(
    quote: any,
    walletAddress: string,
    fee?: { takingFeeBps: number; takingFeeReceiver: string }
  ): Promise<SwapOrder> {
    try {
      const preset = quote.getPreset();
      const secretsCount = preset.secretsCount;

      // Generate secrets for the swap
      const secrets = Array.from({ length: secretsCount }).map(() =>
        randomBytes(32).toString("hex")
      );

      const secretHashes = secrets.map((secret) => HashLock.hashSecret(secret));

      // Create HashLock based on number of secrets
      const hashLock =
        secretsCount === 1
          ? HashLock.forSingleFill(secrets[0])
          : HashLock.forMultipleFills(
              secretHashes.map((secretHash, i) =>
                ethers.keccak256(ethers.toUtf8Bytes(secretHash.toString()))
              ) as any[]
            );

      const orderParams: OrderParams = {
        walletAddress,
        hashLock,
        secretHashes,
        fee,
      };

      const order = await this.sdk.createOrder(quote, orderParams);

      return {
        orderHash: order.hash || this.generateOrderHash(order),
        secrets,
        secretHashes: secretHashes.map((h) => h.toString()),
        hashLock,
        status: "created",
      };
    } catch (error) {
      console.error("Error creating swap order:", error);
      throw error;
    }
  }

  /**
   * Monitor order status and escrow creation
   */
  async monitorOrderStatus(orderHash: string) {
    try {
      const status = await this.sdk.getOrderStatus(orderHash);
      return status;
    } catch (error) {
      console.error("Error monitoring order status:", error);
      throw error;
    }
  }

  /**
   * Check if order is ready to accept secret fills
   */
  async isReadyForSecretFill(orderHash: string) {
    try {
      const readyStatus = await this.sdk.getReadyToAcceptSecretFills(orderHash);
      return readyStatus;
    } catch (error) {
      console.error("Error checking secret fill readiness:", error);
      throw error;
    }
  }

  /**
   * Check if ready for public actions (secret submission)
   */
  async isReadyForPublicActions() {
    try {
      const readyStatus = await this.sdk.getReadyToExecutePublicActions();
      return readyStatus;
    } catch (error) {
      console.error("Error checking public actions readiness:", error);
      throw error;
    }
  }

  /**
   * Get published secrets for an order
   */
  async getPublishedSecrets(orderHash: string) {
    try {
      const secrets = await this.sdk.getPublishedSecrets(orderHash);
      return secrets;
    } catch (error) {
      console.error("Error getting published secrets:", error);
      throw error;
    }
  }

  /**
   * Submit secret to complete the swap
   */
  async submitSecret(orderHash: string, secret: string) {
    try {
      await this.sdk.submitSecret(orderHash, secret);
      console.log(`Secret submitted successfully for order: ${orderHash}`);
    } catch (error) {
      console.error("Error submitting secret:", error);
      throw error;
    }
  }

  /**
   * Get active orders with pagination
   */
  async getActiveOrders(page: number = 1, limit: number = 10) {
    try {
      const orders = await this.sdk.getActiveOrders({ page, limit });
      return orders;
    } catch (error) {
      console.error("Error getting active orders:", error);
      throw error;
    }
  }

  /**
   * Get orders by maker address
   */
  async getOrdersByMaker(
    address: string,
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const orders = await this.sdk.getOrdersByMaker({ address, page, limit });
      return orders;
    } catch (error) {
      console.error("Error getting orders by maker:", error);
      throw error;
    }
  }

  /**
   * Generate order hash for tracking
   */
  private generateOrderHash(order: any): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes32"],
        [
          order.maker || "0x0",
          order.amount || "0",
          order.salt || randomBytes(32),
        ]
      )
    );
  }

  /**
   * Create ETH → DOT swap
   */
  async createEthToDotSwap(
    ethAmount: string,
    walletAddress: string,
    dotRecipient: string
  ): Promise<SwapOrder> {
    const params: CrossChainSwapParams = {
      srcChainId: NetworkEnum.ETHEREUM,
      dstChainId: POLKADOT_CONFIG.ROCOCO_PARACHAIN_ID,
      srcTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // ETH
      dstTokenAddress: "DOT", // Polkadot native token
      amount: ethers.parseEther(ethAmount).toString(),
      walletAddress,
    };

    const quote = await this.getSwapQuote(params);
    return this.createSwapOrder(quote, walletAddress);
  }

  /**
   * Create DOT → ETH swap
   */
  async createDotToEthSwap(
    dotAmount: string,
    walletAddress: string,
    ethRecipient: string
  ): Promise<SwapOrder> {
    const params: CrossChainSwapParams = {
      srcChainId: POLKADOT_CONFIG.ROCOCO_PARACHAIN_ID,
      dstChainId: NetworkEnum.ETHEREUM,
      srcTokenAddress: "DOT", // Polkadot native token
      dstTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // ETH
      amount: dotAmount,
      walletAddress,
    };

    const quote = await this.getSwapQuote(params);
    return this.createSwapOrder(quote, walletAddress);
  }

  /**
   * Execute complete bidirectional swap workflow
   */
  async executeBidirectionalSwap(
    direction: "eth-to-dot" | "dot-to-eth",
    amount: string,
    walletAddress: string,
    recipientAddress: string
  ): Promise<{
    order: SwapOrder;
    escrowTx?: any;
    finalStatus: string;
  }> {
    try {
      // Step 1: Create the swap order
      const order =
        direction === "eth-to-dot"
          ? await this.createEthToDotSwap(
              amount,
              walletAddress,
              recipientAddress
            )
          : await this.createDotToEthSwap(
              amount,
              walletAddress,
              recipientAddress
            );

      console.log(`Created ${direction} swap order:`, order.orderHash);

      // Step 2: Wait for escrow creation and finality
      let attempts = 0;
      const maxAttempts = 30; // 5 minutes with 10-second intervals

      while (attempts < maxAttempts) {
        const isReady = await this.isReadyForSecretFill(order.orderHash);

        if (isReady) {
          console.log("Escrows created and finality period passed");
          break;
        }

        console.log(
          `Waiting for escrow creation... (${attempts + 1}/${maxAttempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
        attempts++;
      }

      if (attempts >= maxAttempts) {
        throw new Error("Timeout waiting for escrow creation");
      }

      // Step 3: Check if public actions are ready
      const publicActionsReady = await this.isReadyForPublicActions();
      if (!publicActionsReady) {
        throw new Error("System not ready for public actions");
      }

      // Step 4: Submit secret to complete the swap
      await this.submitSecret(order.orderHash, order.secrets[0]);

      // Step 5: Monitor final status
      const finalStatus = await this.monitorOrderStatus(order.orderHash);

      return {
        order: { ...order, status: "completed" },
        finalStatus: finalStatus.status || "completed",
      };
    } catch (error) {
      console.error(`Error executing ${direction} swap:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const fusionSDK = new FusionCrossChainSDK();

// Export utility functions
export { HashLock } from "@1inch/cross-chain-sdk";
