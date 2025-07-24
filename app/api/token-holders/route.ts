import { NextResponse } from "next/server";

interface TokenHolderData {
  holders: number;
  totalSupply: string;
  circulatingSupply: string;
  marketCap: number;
  price: number;
  volume24h: number;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tokenAddress = searchParams.get("tokenAddress");
    const chainId = searchParams.get("chainId");

    if (!tokenAddress || !chainId) {
      return NextResponse.json(
        { error: "Token address and chainId are required" },
        { status: 400 }
      );
    }

    const chainMap: Record<string, string> = {
      "1": "eth-mainnet",
      "8453": "base-mainnet",
      "56": "bsc-mainnet",
      "137": "polygon-mainnet",
      "42161": "arbitrum-mainnet",
      "10": "optimism-mainnet",
    };

    const covalentChain = chainMap[chainId];
    if (!covalentChain) {
      return NextResponse.json(
        { error: "Unsupported chain ID" },
        { status: 400 }
      );
    }

    const COVALENT_API_KEY =
      process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY;
    if (!COVALENT_API_KEY) {
      return NextResponse.json(
        { error: "Covalent API key not configured" },
        { status: 500 }
      );
    }

    try {
      const response = await fetch(
        `https://api.covalenthq.com/v1/${covalentChain}/tokens/${tokenAddress}/token_holders/?key=${COVALENT_API_KEY}&page-size=1&with-uncached=true`
      );

      if (!response.ok) {
        throw new Error(`Covalent API error: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(
          `Covalent API error: ${data.error_message || data.error}`
        );
      }

      const holders = data.data?.pagination?.total_count || 0;

      const metadataResponse = await fetch(
        `https://api.covalenthq.com/v1/${covalentChain}/tokens/${tokenAddress}/?key=${COVALENT_API_KEY}`
      );

      let tokenMetadata = null;
      if (metadataResponse.ok) {
        const metadataData = await metadataResponse.json();
        if (!metadataData.error && metadataData.data?.items?.[0]) {
          tokenMetadata = metadataData.data.items[0];
        }
      }

      const result: TokenHolderData = {
        holders,
        totalSupply: tokenMetadata?.total_supply || "0",
        circulatingSupply: tokenMetadata?.circulating_supply || "0",
        marketCap: tokenMetadata?.market_cap || 0,
        price: tokenMetadata?.quote_rate || 0,
        volume24h: tokenMetadata?.volume_24h || 0,
      };

      return NextResponse.json({
        success: true,
        data: result,
      });
    } catch (apiError) {
      console.error("Error fetching from Covalent API:", apiError);

      const fallbackData: TokenHolderData = {
        holders: 0,
        totalSupply: "0",
        circulatingSupply: "0",
        marketCap: 0,
        price: 0,
        volume24h: 0,
      };

      return NextResponse.json({
        success: false,
        error: "Failed to fetch holder data",
        data: fallbackData,
      });
    }
  } catch (error) {
    console.error("Token holders API error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
