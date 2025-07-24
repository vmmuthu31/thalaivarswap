/* eslint-disable @typescript-eslint/no-explicit-any */
import { formatOutputAmount } from "@/lib/formatOutputAmount";
import { getChainConfig } from "@/lib/getChainConfig";
import { ethers } from "ethers";

const WRAPPED_NATIVE_TOKENS: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on Ethereum
  56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB on BSC
  8453: "0x4200000000000000000000000000000000000006", // WETH on BASE
};

const ONEINCH_CHAIN_IDS = {
  1: "1", // Ethereum
  56: "56", // BSC
  137: "137", // Polygon
  42161: "42161", // Arbitrum
  8453: "8453", // Base
};

function oneInchApiRequestUrl(
  chainId: string,
  methodName: string,
  queryParams: Record<string, any>
): string {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://trade.agenttheo.com";

  const url = `${baseUrl}/api/oneinch/${chainId}${methodName}?${new URLSearchParams(
    queryParams
  ).toString()}`;

  console.log(`Making 1inch API call to: ${url}`);
  return url;
}

let lastApiCall = 0;
const MIN_API_INTERVAL = 1000; // Minimum 1 second between API calls

const rateLimitedFetch = async (
  url: string,
  options?: RequestInit
): Promise<Response> => {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;

  if (timeSinceLastCall < MIN_API_INTERVAL) {
    const waitTime = MIN_API_INTERVAL - timeSinceLastCall;
    console.log(`Rate limiting: waiting ${waitTime}ms before API call`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastApiCall = Date.now();
  return fetch(url, options);
};
export const buildOneInchApprovalTransaction = async (
  tokenAddress: string,
  chainId: string,
  amount?: string
): Promise<any> => {
  try {
    const params = amount ? { tokenAddress, amount } : { tokenAddress };

    const url = oneInchApiRequestUrl(chainId, "/approve", params);

    const response = await rateLimitedFetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `1inch approval API error: ${response.status} ${response.statusText}`
      );
    }

    const transaction = await response.json();
    return transaction;
  } catch (error) {
    console.error("Error building 1inch approval transaction:", error);
    throw error;
  }
};

export const buildOneInchSwapTransaction = async (
  src: string,
  dst: string,
  amount: string,
  from: string,
  chain: string,
  slippage: number = 1,
  disableEstimate: boolean = false,
  allowPartialFill: boolean = false
): Promise<any> => {
  try {
    const chainConfig = getChainConfig(chain);
    const chainId =
      ONEINCH_CHAIN_IDS[chainConfig.chainId as keyof typeof ONEINCH_CHAIN_IDS];

    if (!chainId) {
      throw new Error(`1inch not supported on chain ID ${chainConfig.chainId}`);
    }

    if (src.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
      src = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    if (
      src.toLowerCase() ===
      WRAPPED_NATIVE_TOKENS[chainConfig.chainId].toLowerCase()
    ) {
      console.log(
        `Using WETH address for chain ${chainConfig.chainId}: ${
          WRAPPED_NATIVE_TOKENS[chainConfig.chainId]
        }`
      );
    }

    if (dst.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
      dst = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    let amountInWei = amount;
    if (!amount.includes("000000000000000000")) {
      amountInWei = ethers.utils.parseEther(amount).toString();
    }

    const swapParams = {
      src,
      dst,
      amount: amountInWei,
      from,
      origin: from,
      slippage,
      disableEstimate,
      allowPartialFill,
    };

    const url = oneInchApiRequestUrl(chainId, "/swap", swapParams);

    console.log("1inch Swap URL:", url);
    console.log("1inch Swap Params:", swapParams);

    const response = await rateLimitedFetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("1inch Swap API error response:", errorText);

      try {
        const errorData = JSON.parse(errorText);
        throw new Error(
          `1inch swap API error: ${response.status} - ${
            errorData.description || errorData.error || response.statusText
          }`
        );
      } catch {
        throw new Error(
          `1inch swap API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }
    }

    const data = await response.json();
    console.log("1inch Swap Response:", data);

    return data.tx;
  } catch (error) {
    console.error("Error building 1inch swap transaction:", error);
    throw error;
  }
};

export const getOneInchSwapQuote = async (
  src: string,
  dst: string,
  amount: string,
  chain: string
): Promise<{
  expectedOutput: string;
  formattedOutput: string;
  priceImpact: number;
  inputTokenSymbol?: string;
  outputTokenSymbol?: string;
  estimatedGas?: string;
}> => {
  try {
    const chainConfig = getChainConfig(chain);
    const chainId =
      ONEINCH_CHAIN_IDS[chainConfig.chainId as keyof typeof ONEINCH_CHAIN_IDS];

    if (!chainId) {
      throw new Error(`1inch not supported on chain ID ${chainConfig.chainId}`);
    }

    const amountInWei = ethers.utils.parseEther(amount).toString();

    const quoteParams = {
      src,
      dst,
      amount: amountInWei,
      includeTokensInfo: "true",
      includeProtocols: "true",
      includeGas: "true",
    };

    const url = oneInchApiRequestUrl(chainId, "/quote", quoteParams);

    const response = await rateLimitedFetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("1inch API error response:", errorText);

      let errorDetails = errorText;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.details) {
          const details = JSON.parse(errorData.details);
          if (details.description === "insufficient liquidity") {
            console.warn(
              "Insufficient liquidity for this token pair. Consider:"
            );
            console.warn("1. Using a different token pair with more liquidity");
            console.warn("2. Reducing the trade amount");
            console.warn("3. Trying a different chain or DEX");

            throw new Error(
              `Insufficient liquidity for this token pair. Try a smaller amount or different tokens.`
            );
          }
          errorDetails = details.description || errorDetails;
        }
      } catch {
        console.warn("Failed to parse error details, using raw response.");
      }

      throw new Error(
        `1inch API error: ${response.status} ${response.statusText} - ${errorDetails}`
      );
    }

    const data = await response.json();

    const srcToken = data.srcToken;
    const dstToken = data.dstToken;

    const outputAmount = ethers.utils.formatUnits(
      data.dstAmount,
      dstToken.decimals
    );
    const formattedOutput = formatOutputAmount(outputAmount);

    let priceImpact = 0.5;
    if (data.priceImpact) {
      priceImpact = parseFloat(data.priceImpact);
    } else {
      const amountInEth = parseFloat(amount);
      if (amountInEth >= 10) {
        priceImpact = 2.0;
      } else if (amountInEth >= 1) {
        priceImpact = 1.0;
      } else {
        priceImpact = 0.5;
      }
    }

    return {
      expectedOutput: outputAmount,
      formattedOutput,
      priceImpact,
      inputTokenSymbol: srcToken.symbol,
      outputTokenSymbol: dstToken.symbol,
      estimatedGas: data.gas?.toString() || "150000",
    };
  } catch (error) {
    console.error("Error getting 1inch quote:", error);
    throw error;
  }
};

export const getEnhancedSwapQuote = async (
  fromToken: string,
  toToken: string,
  amount: string,
  chain: string
): Promise<{
  expectedOutput: string;
  estimatedGas?: string;
  formattedOutput: string;
  priceImpact: number;
  inputTokenSymbol?: string;
  outputTokenSymbol?: string;
  provider?: string;
}> => {
  try {
    const chainConfig = getChainConfig(chain);
    const chainId = chainConfig.chainId;

    const correctWrappedNative = WRAPPED_NATIVE_TOKENS[chainId];

    let oneInchFromToken = fromToken;
    let oneInchToToken = toToken;

    if (fromToken.toLowerCase() === correctWrappedNative.toLowerCase()) {
      oneInchFromToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      console.log(
        `Converting WETH to ETH for 1inch quote: ${fromToken} -> ${oneInchFromToken}`
      );
    }

    if (toToken.toLowerCase() === correctWrappedNative.toLowerCase()) {
      oneInchToToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      console.log(
        `Converting WETH to ETH for 1inch quote: ${toToken} -> ${oneInchToToken}`
      );
    }

    console.log("Attempting to get quote from 1inch...");
    const oneInchQuote = await getOneInchSwapQuote(
      oneInchFromToken,
      oneInchToToken,
      amount,
      chain
    );

    if (oneInchQuote.expectedOutput !== "0") {
      return {
        ...oneInchQuote,
      };
    }
  } catch (error) {
    console.log("1inch quote failed, falling back to DEX quotes:", error);
  }
  throw new Error("No swap quote available from 1inch or fallback DEX.");
};
