import { NextResponse } from "next/server";
import { Chain, GoldRushClient } from "@covalenthq/client-sdk";

interface AssetForecast {
  price: number;
  percentage: number;
  confidence: number;
  timeframe: string;
}

interface Asset {
  token: string;
  name: string;
  amount: number;
  value: number;
  price: number;
  change24h: number;
  logoUrl: string;
  chainName: string;
  contractAddress: string;
  forecast: AssetForecast;
}

interface ForecastDriver {
  name: string;
  impact: "High" | "Medium" | "Low";
  direction: "Positive" | "Negative" | "Neutral";
}

interface PortfolioForecast {
  value: number;
  percentage: number;
  confidence: number;
  drivers: ForecastDriver[];
}

interface PortfolioData {
  assets: Asset[];
  totalValue: number;
  changePercentage: number;
  forecast: PortfolioForecast;
  walletAddress: string;
  chainsCovered: string[];
  tokenCount: number;
}

const GOLDRUSH_API_KEY = process.env.GOLDRUSH_API_KEY || "YOUR_API_KEY";
const goldRushClient = new GoldRushClient(GOLDRUSH_API_KEY);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("walletaddress");
    const walletType = searchParams.get("wallettype") || "evm";

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Wallet address is required" },
        { status: 400 }
      );
    }

    try {
      const chains =
        walletType === "evm"
          ? ["eth-mainnet", "base-mainnet", "bsc-mainnet"]
          : ["solana-mainnet"];

      const balancesPromises = chains.map((chain) =>
        goldRushClient.BalanceService.getTokenBalancesForWalletAddress(
          chain as Chain,
          walletAddress
        )
      );

      const balancesResults = await Promise.all(balancesPromises);

      const portfolioPromise =
        goldRushClient.BalanceService.getHistoricalPortfolioForWalletAddress(
          "eth-mainnet",
          walletAddress,
          { days: 30 }
        );

      const portfolioResult = await portfolioPromise;

      let totalValue = 0;
      const assets: Asset[] = [];

      const chainNames: string[] = [];

      balancesResults.forEach((result, index) => {
        if (!result.error && result.data) {
          if (result.data.chain_name) {
            chainNames.push(result.data.chain_name);
          }

          result.data.items?.forEach((item) => {
            const amount =
              parseFloat(item.balance?.toString() || "0") /
              Math.pow(10, item.contract_decimals || 18);

            const value = item.quote || 0;
            totalValue += value;

            assets.push({
              token: item.contract_ticker_symbol || "Unknown",
              name: item.contract_name || "Unknown Token",
              amount: amount,
              value: value,
              price: item.quote_rate || 0,
              change24h:
                item.quote_rate && item.quote_rate_24h
                  ? ((item.quote_rate - item.quote_rate_24h) /
                      item.quote_rate_24h) *
                    100
                  : 0,
              logoUrl: item.logo_url || "",
              chainName: result.data.chain_name || chains[index],
              contractAddress: item.contract_address || "",
              forecast: {
                price:
                  (item.quote_rate || 0) * (1 + (Math.random() * 0.1 - 0.05)), // ±5% random variation
                percentage:
                  item.quote_rate && item.quote_rate_24h
                    ? ((item.quote_rate - item.quote_rate_24h) /
                        item.quote_rate_24h) *
                      100 *
                      1.2
                    : 0,
                confidence: 0.7 + Math.random() * 0.2,
                timeframe: "7d",
              },
            });
          });
        }
      });

      let changePercentage = 0;

      if (
        portfolioResult.data &&
        portfolioResult.data.items &&
        portfolioResult.data.items.length > 1
      ) {
        const portfolioItems = portfolioResult.data.items;
        const latestItems = portfolioItems.slice(-2);

        if (latestItems.length === 2) {
          const latest = latestItems[1];
          const previous = latestItems[0];

          let latestValue = 0;
          let previousValue = 0;

          if (latest.holdings) {
            latest.holdings.forEach((holding) => {
              if (holding.close && holding.close.quote) {
                latestValue += holding.close.quote;
              }
            });
          }

          if (previous.holdings) {
            previous.holdings.forEach((holding) => {
              if (holding.close && holding.close.quote) {
                previousValue += holding.close.quote;
              }
            });
          }

          if (previousValue > 0) {
            changePercentage =
              ((latestValue - previousValue) / previousValue) * 100;
          }
        }
      } else if (assets.length > 0) {
        let weightedSum = 0;
        assets.forEach((asset) => {
          weightedSum += asset.change24h * asset.value;
        });
        changePercentage = weightedSum / totalValue;
      }

      const forecastValue = totalValue * (1 + (changePercentage / 100) * 1.5);
      const forecastPercentage =
        ((forecastValue - totalValue) / totalValue) * 100;

      assets.sort((a, b) => b.value - a.value);

      const portfolioData: PortfolioData = {
        assets,
        totalValue,
        changePercentage,
        forecast: {
          value: forecastValue,
          percentage: forecastPercentage,
          confidence: 0.8,
          drivers: [
            {
              name: "Market Trend",
              impact:
                changePercentage > 2
                  ? "High"
                  : changePercentage > 0
                  ? "Medium"
                  : "Low",
              direction: changePercentage > 0 ? "Positive" : "Negative",
            },
            {
              name: assets[0]?.token + " Performance",
              impact: "High",
              direction: assets[0]?.change24h > 0 ? "Positive" : "Negative",
            },
            {
              name: "Portfolio Diversity",
              impact: "Medium",
              direction: assets.length > 3 ? "Positive" : "Neutral",
            },
          ],
        },
        walletAddress,
        chainsCovered: chainNames.length > 0 ? chainNames : chains,
        tokenCount: assets.length,
      };

      return NextResponse.json(portfolioData);
    } catch (fetchError) {
      console.error("Error fetching from GoldRush API:", fetchError);

      const errorMessage =
        fetchError instanceof Error ? fetchError.message : "Unknown error";

      return NextResponse.json(
        {
          error: "Failed to fetch portfolio data from GoldRush",
          details: errorMessage,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("Portfolio API error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
