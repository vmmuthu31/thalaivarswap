"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowUpDown,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Zap,
  Settings,
  Info,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";

interface SwapQuote {
  direction: string;
  inputAmount: string;
  outputAmount: string;
  exchangeRate: number;
  slippage: number;
  estimatedTime: string;
  fees: {
    networkFee: string;
    protocolFee: string;
    total: string;
  };
  minimumAmount: string;
  priceImpact: string;
}

interface SwapResult {
  success: boolean;
  swapId: string;
  direction: string;
  amount: string;
  estimatedOutput: string;
  txHash?: string;
  status: string;
  timestamp: string;
  details: any;
}

interface SystemStatus {
  ethereum: {
    network: string;
    status: string;
    blockNumber: number;
  };
  polkadot: {
    network: string;
    status: string;
    blockNumber: number;
  };
  directSwap: {
    status: string;
    provider: string;
  };
  totalSwaps: number;
  successRate: string;
}

// Realistic market prices (Aug 2025)
const ETH_PRICE = 2500; // $2500 per ETH
const DOT_PRICE = 5.25; // $5.25 per DOT

const TokenIcon = ({ token }: { token: string }) => {
  if (token === "ETH") {
    return (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
        <span className="text-white font-bold text-lg">Ξ</span>
      </div>
    );
  } else {
    return (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-pink-600 flex items-center justify-center">
        <span className="text-white font-bold text-lg">●</span>
      </div>
    );
  }
};

export default function SwapPage() {
  const [fromToken, setFromToken] = useState("ETH");
  const [toToken, setToToken] = useState("DOT");
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [swapResult, setSwapResult] = useState<SwapResult | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [useRealTx, setUseRealTx] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [slippage, setSlippage] = useState(3);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  useEffect(() => {
    if (amount && parseFloat(amount) > 0) {
      fetchQuote();
    } else {
      setQuote(null);
      setError(null);
    }
  }, [amount, fromToken, toToken]);

  const fetchSystemStatus = async () => {
    try {
      const response = await fetch("/api/swaps/execute-ui?action=status");
      const data = await response.json();
      if (data.success) {
        setSystemStatus(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch system status:", error);
    }
  };

  const fetchQuote = async () => {
    try {
      setError(null);
      const direction = fromToken === "ETH" ? "eth-to-dot" : "dot-to-eth";
      const response = await fetch(
        `/api/swaps/execute-ui?action=quote&direction=${direction}&amount=${amount}`
      );
      const data = await response.json();
      if (data.success) {
        setQuote(data.data);
      } else {
        setError(data.error);
      }
    } catch (error) {
      console.error("Failed to fetch quote:", error);
      setError("Failed to fetch quote");
    }
  };

  const executeSwap = async () => {
    setIsLoading(true);
    setSwapResult(null);
    setError(null);

    try {
      const direction = fromToken === "ETH" ? "eth-to-dot" : "dot-to-eth";

      const response = await fetch("/api/swaps/execute-ui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          direction,
          amount,
          useRealTx,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSwapResult(data.data);
      } else {
        setError(data.error);
        setSwapResult({
          success: false,
          swapId: "failed",
          direction,
          amount,
          estimatedOutput: "0",
          status: "failed",
          timestamp: new Date().toISOString(),
          details: { error: data.error },
        });
      }
    } catch (error) {
      console.error("Swap execution failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setError(errorMessage);
      setSwapResult({
        success: false,
        swapId: "error",
        direction: fromToken === "ETH" ? "eth-to-dot" : "dot-to-eth",
        amount,
        estimatedOutput: "0",
        status: "failed",
        timestamp: new Date().toISOString(),
        details: { error: errorMessage },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const swapTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    // Reset amount to minimum for new direction
    if (fromToken === "ETH") {
      setAmount("0.01"); // DOT minimum
    } else {
      setAmount("0.001"); // ETH minimum
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "demo":
        return <Info className="w-5 h-5 text-blue-500" />;
      case "pending":
      case "processing":
        return <Clock className="w-5 h-5 text-yellow-500 animate-spin" />;
      case "failed":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const formatNumber = (num: string) => {
    const parsed = parseFloat(num);
    if (parsed === 0) return "0.0";
    if (parsed < 0.0001) return parsed.toExponential(2);
    if (parsed < 1) return parsed.toFixed(6);
    if (parsed < 1000) return parsed.toFixed(4);
    return parsed.toLocaleString();
  };

  const getMinimumAmount = () => {
    return fromToken === "ETH" ? "0.001 ETH" : "0.01 DOT";
  };

  const isAmountValid = () => {
    const numAmount = parseFloat(amount || "0");
    if (fromToken === "ETH") {
      return numAmount >= 0.001;
    } else {
      return numAmount >= 0.01;
    }
  };

  const setMaxAmount = () => {
    if (fromToken === "ETH") {
      setAmount("1.19"); // Available ETH balance
    } else {
      setAmount("49.93"); // Available DOT balance
    }
  };

  const setMinAmount = () => {
    if (fromToken === "ETH") {
      setAmount("0.001");
    } else {
      setAmount("0.01");
    }
  };

  const getUsdValue = (token: string, amount: string) => {
    const numAmount = parseFloat(amount || "0");
    if (token === "ETH") {
      return (numAmount * ETH_PRICE).toFixed(2);
    } else {
      return (numAmount * DOT_PRICE).toFixed(2);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Zap className="w-10 h-10 text-yellow-400" />
            ThalaivarSwap
          </h1>
          <p className="text-gray-300 text-lg">
            Cross-Chain ETH ↔ DOT Swaps • Real Market Rates
          </p>
          <p className="text-gray-400 text-sm mt-2">
            ETH: ${ETH_PRICE.toLocaleString()} • DOT: ${DOT_PRICE} • Rate: 1 ETH
            = {(ETH_PRICE / DOT_PRICE).toFixed(0)} DOT
          </p>
        </div>

        {/* System Status Bar */}
        {systemStatus && (
          <div className="max-w-4xl mx-auto mb-8">
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-6">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-green-400 text-sm font-medium">
                      {systemStatus.ethereum.network}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse"></div>
                    <span className="text-pink-400 text-sm font-medium">
                      {systemStatus.polkadot.network}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    <span className="text-blue-400 text-sm font-medium">
                      {systemStatus.successRate} Success Rate
                    </span>
                  </div>
                </div>
                <div className="text-gray-400 text-sm">
                  {systemStatus.totalSwaps} Total Swaps
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-lg mx-auto">
          {/* Main Swap Interface */}
          <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Swap</h2>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <Settings className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Settings Panel */}
            {showSettings && (
              <div className="bg-white/5 rounded-xl p-4 mb-6 border border-white/10">
                <h3 className="text-white font-medium mb-3">Settings</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-gray-300 text-sm mb-2">
                      Slippage Tolerance
                    </label>
                    <div className="flex space-x-2">
                      {[1, 3, 5].map((value) => (
                        <button
                          key={value}
                          onClick={() => setSlippage(value)}
                          className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                            slippage === value
                              ? "bg-blue-500 text-white"
                              : "bg-white/10 text-gray-300 hover:bg-white/20"
                          }`}
                        >
                          {value}%
                        </button>
                      ))}
                    </div>
                  </div>
                                  </div>
              </div>
            )}

            {/* From Token */}
            <div className="mb-2">
              <div className="flex justify-between items-center mb-2">
                <label className="text-gray-400 text-sm font-medium">
                  From
                </label>
                <div className="flex items-center space-x-2">
                  <span className="text-gray-400 text-sm">
                    Balance: {fromToken === "ETH" ? "1.19" : "49.93"}
                  </span>
                  <button
                    onClick={setMaxAmount}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <TokenIcon token={fromToken} />
                    <div>
                      <div className="text-white font-semibold text-lg">
                        {fromToken}
                      </div>
                      <div className="text-gray-400 text-sm">
                        {fromToken === "ETH" ? "Ethereum" : "Polkadot"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="bg-transparent text-white text-right text-2xl font-semibold outline-none w-32 placeholder-gray-500"
                      placeholder="0.0"
                      step={fromToken === "ETH" ? "0.001" : "0.1"}
                      min="0"
                    />
                    <div className="text-gray-400 text-sm text-right">
                      ≈ ${getUsdValue(fromToken, amount)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Minimum Amount Warning */}
              {amount && !isAmountValid() && (
                <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    <span className="text-yellow-400 text-sm">
                      Minimum amount: {getMinimumAmount()}
                    </span>
                    <button
                      onClick={setMinAmount}
                      className="text-yellow-400 hover:text-yellow-300 text-sm font-medium underline"
                    >
                      Set minimum
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="flex justify-center my-4">
              <button
                onClick={swapTokens}
                className="bg-white/10 hover:bg-white/20 rounded-full p-3 transition-all duration-200 hover:scale-110"
              >
                <ArrowUpDown className="w-6 h-6 text-white" />
              </button>
            </div>

            {/* To Token */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <label className="text-gray-400 text-sm font-medium">To</label>
                <div className="text-gray-400 text-sm">
                  Balance: {toToken === "DOT" ? "49.93" : "1.19"}
                </div>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <TokenIcon token={toToken} />
                    <div>
                      <div className="text-white font-semibold text-lg">
                        {toToken}
                      </div>
                      <div className="text-gray-400 text-sm">
                        {toToken === "DOT" ? "Polkadot" : "Ethereum"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white text-2xl font-semibold">
                      {quote ? formatNumber(quote.outputAmount) : "0.0"}
                    </div>
                    <div className="text-gray-400 text-sm">
                      ≈ $
                      {quote
                        ? getUsdValue(toToken, quote.outputAmount)
                        : "0.00"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quote Details */}
            {quote && isAmountValid() && (
              <div className="bg-white/5 rounded-xl p-4 mb-6 border border-white/10">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Rate</span>
                    <span className="text-white">
                      1 {fromToken} ={" "}
                      {formatNumber(quote.exchangeRate.toString())} {toToken}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Slippage</span>
                    <span className="text-white">{quote.slippage}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Price Impact</span>
                    <span className="text-white">{quote.priceImpact}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Estimated Time</span>
                    <span className="text-white">{quote.estimatedTime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Network Fee</span>
                    <span className="text-white">{quote.fees.networkFee}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Protocol Fee</span>
                    <span className="text-white">{quote.fees.protocolFee}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                  <span className="text-red-400 font-medium">Error</span>
                </div>
                <p className="text-red-300 text-sm mt-2">{error}</p>
              </div>
            )}

            {/* Execute Button */}
            <button
              onClick={executeSwap}
              disabled={isLoading || !amount || !isAmountValid() || !!error}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold py-4 px-6 rounded-2xl transition-all duration-200 disabled:cursor-not-allowed transform hover:scale-[1.02] disabled:hover:scale-100"
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Executing Swap...</span>
                </div>
              ) : !isAmountValid() ? (
                `Minimum: ${getMinimumAmount()}`
              ) : (
                "Execute Swap"
              )}
            </button>

                      </div>

          {/* Swap Result */}
          {swapResult && (
            <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-6">
              <div className="flex items-center space-x-3 mb-4">
                {getStatusIcon(swapResult.status)}
                <h3 className="text-xl font-semibold text-white">
                  {swapResult.success ? "Swap Executed" : "Swap Failed"}
                </h3>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Swap ID</span>
                  <span className="text-white font-mono text-sm">
                    {swapResult.swapId.substring(0, 16)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Direction</span>
                  <span className="text-white">
                    {swapResult.direction === "eth-to-dot"
                      ? "ETH → DOT"
                      : "DOT → ETH"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Amount</span>
                  <span className="text-white">
                    {swapResult.amount} {fromToken} (≈ $
                    {getUsdValue(fromToken, swapResult.amount)})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Received</span>
                  <span className="text-white">
                    {formatNumber(swapResult.estimatedOutput)} {toToken} (≈ $
                    {getUsdValue(toToken, swapResult.estimatedOutput)})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span
                    className={`font-medium ${
                      swapResult.status === "completed"
                        ? "text-green-400"
                        : swapResult.status === "demo"
                        ? "text-blue-400"
                        : swapResult.status === "failed"
                        ? "text-red-400"
                        : "text-yellow-400"
                    }`}
                  >
                    {swapResult.status.toUpperCase()}
                  </span>
                </div>

                {/* Transaction Links */}
                {swapResult.details?.explorerUrls && (
                  <div className="pt-4 border-t border-white/10">
                    <h4 className="text-white font-medium mb-3">
                      Blockchain Transactions
                    </h4>
                    <div className="space-y-2">
                      {swapResult.details.explorerUrls.ethereum && (
                        <a
                          href={swapResult.details.explorerUrls.ethereum}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-colors"
                        >
                          <div className="flex items-center space-x-3">
                            <TokenIcon token="ETH" />
                            <div>
                              <div className="text-white font-medium">
                                Ethereum Transaction
                              </div>
                              <div className="text-gray-400 text-sm font-mono">
                                {swapResult.details.ethTxHash?.substring(0, 20)}
                                ...
                              </div>
                            </div>
                          </div>
                          <ExternalLink className="w-5 h-5 text-blue-400" />
                        </a>
                      )}
                      {swapResult.details.explorerUrls.polkadot && (
                        <a
                          href={swapResult.details.explorerUrls.polkadot}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-pink-500/10 rounded-lg hover:bg-pink-500/20 transition-colors"
                        >
                          <div className="flex items-center space-x-3">
                            <TokenIcon token="DOT" />
                            <div>
                              <div className="text-white font-medium">
                                Polkadot Transaction
                              </div>
                              <div className="text-gray-400 text-sm font-mono">
                                {swapResult.details.polkadotTxHash?.substring(
                                  0,
                                  20
                                )}
                                ...
                              </div>
                            </div>
                          </div>
                          <ExternalLink className="w-5 h-5 text-pink-400" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Error Details */}
                {!swapResult.success && swapResult.details?.error && (
                  <div className="pt-4 border-t border-white/10">
                    <h4 className="text-red-400 font-medium mb-2">
                      Error Details
                    </h4>
                    <p className="text-gray-300 text-sm bg-red-500/10 p-3 rounded-lg">
                      {swapResult.details.error}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-400">
          <p>
            Powered by ThalaivarSwap • Real Market Rates & Cross-Chain
            Technology
          </p>
          <p className="text-sm mt-1">
            Minimum amounts: 0.001 ETH • 0.01 DOT • Current rate: 1 ETH ={" "}
            {(ETH_PRICE / DOT_PRICE).toFixed(0)} DOT
          </p>
        </div>
      </div>
    </div>
  );
}
