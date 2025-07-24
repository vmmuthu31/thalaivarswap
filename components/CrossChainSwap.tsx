"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import {
  BidirectionalRelayer,
  type CrossChainSwap,
} from "../lib/bidirectional-relayer";
import { FusionCrossChainSDK } from "../lib/fusion-sdk";

interface SwapFormData {
  direction: "eth-to-dot" | "dot-to-eth";
  amount: string;
  senderAddress: string;
  recipientAddress: string;
}

interface SwapStatus {
  swap: CrossChainSwap | null;
  isLoading: boolean;
  error: string | null;
  logs: string[];
}

export default function CrossChainSwap() {
  const [formData, setFormData] = useState<SwapFormData>({
    direction: "eth-to-dot",
    amount: "",
    senderAddress: "",
    recipientAddress: "",
  });

  const [swapStatus, setSwapStatus] = useState<SwapStatus>({
    swap: null,
    isLoading: false,
    error: null,
    logs: [],
  });

  const [relayer, setRelayer] = useState<BidirectionalRelayer | null>(null);
  const [activeSwaps, setActiveSwaps] = useState<CrossChainSwap[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize relayer
  useEffect(() => {
    const initializeRelayer = async () => {
      try {
        const newRelayer = new BidirectionalRelayer(
          process.env.NEXT_PUBLIC_ETH_RPC_URL,
          process.env.NEXT_PUBLIC_ETH_CONTRACT_ADDRESS,
          process.env.NEXT_PUBLIC_FUSION_API_KEY
        );

        await newRelayer.initialize();
        await newRelayer.startMonitoring();

        // Set up event listeners
        newRelayer.on("swap-created", (swap) => {
          addLog(`🎉 Swap Created: ${swap.swapId}`);
          updateActiveSwaps(newRelayer);
        });

        newRelayer.on("escrow-created", (swap, chain) => {
          addLog(`🔒 Escrow created on ${chain} for swap ${swap.swapId}`);
          updateActiveSwaps(newRelayer);
        });

        newRelayer.on("swap-ready", (swap) => {
          addLog(`✅ Swap ${swap.swapId} is ready for completion`);
          updateActiveSwaps(newRelayer);
        });

        newRelayer.on("swap-completed", (swap) => {
          addLog(`🎊 Swap ${swap.swapId} completed successfully!`);
          updateActiveSwaps(newRelayer);
        });

        newRelayer.on("swap-failed", (swap, error) => {
          addLog(`❌ Swap ${swap.swapId} failed: ${error.message}`);
          updateActiveSwaps(newRelayer);
        });

        setRelayer(newRelayer);
        setIsConnected(true);
        addLog("✅ Bidirectional Relayer initialized successfully");
      } catch (error) {
        console.error("Failed to initialize relayer:", error);
        setSwapStatus((prev) => ({
          ...prev,
          error:
            error instanceof Error
              ? error.message
              : "Failed to initialize relayer",
        }));
      }
    };

    initializeRelayer();

    return () => {
      if (relayer) {
        relayer.cleanup();
      }
    };
  }, []);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setSwapStatus((prev) => ({
      ...prev,
      logs: [...prev.logs, `[${timestamp}] ${message}`].slice(-50), // Keep last 50 logs
    }));
  };

  const updateActiveSwaps = (relayerInstance: BidirectionalRelayer) => {
    const swaps = relayerInstance.getAllSwaps();
    setActiveSwaps(swaps);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const connectWallet = async () => {
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        setFormData((prev) => ({
          ...prev,
          senderAddress: address,
        }));
        addLog(`🔗 Wallet connected: ${address}`);
      } else {
        throw new Error("MetaMask not found");
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      setSwapStatus((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "Failed to connect wallet",
      }));
    }
  };

  const validateForm = (): boolean => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setSwapStatus((prev) => ({
        ...prev,
        error: "Please enter a valid amount",
      }));
      return false;
    }

    if (!formData.senderAddress || !ethers.isAddress(formData.senderAddress)) {
      setSwapStatus((prev) => ({
        ...prev,
        error: "Please enter a valid sender address",
      }));
      return false;
    }

    if (!formData.recipientAddress) {
      setSwapStatus((prev) => ({
        ...prev,
        error: "Please enter a recipient address",
      }));
      return false;
    }

    return true;
  };

  const initiateSwap = async () => {
    if (!relayer || !validateForm()) return;

    setSwapStatus((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      swap: null,
    }));

    try {
      addLog(`🚀 Initiating ${formData.direction} swap for ${formData.amount}`);

      let swap: CrossChainSwap;

      if (formData.direction === "eth-to-dot") {
        swap = await relayer.createEthToDotSwap(
          formData.amount,
          formData.senderAddress,
          formData.recipientAddress
        );
      } else {
        swap = await relayer.createDotToEthSwap(
          formData.amount,
          formData.senderAddress,
          formData.recipientAddress
        );
      }

      setSwapStatus((prev) => ({
        ...prev,
        swap,
        isLoading: false,
      }));

      addLog(`📝 Swap created with ID: ${swap.swapId}`);

      // Execute the swap
      await relayer.executeBidirectionalSwap(swap);
    } catch (error) {
      console.error("Swap failed:", error);
      setSwapStatus((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Swap failed",
      }));
      addLog(
        `❌ Swap failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-600";
      case "failed":
        return "text-red-600";
      case "refunded":
        return "text-yellow-600";
      case "ready":
        return "text-blue-600";
      case "escrowed":
        return "text-purple-600";
      default:
        return "text-gray-600";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      case "refunded":
        return "🔄";
      case "ready":
        return "⚡";
      case "escrowed":
        return "🔒";
      case "initiated":
        return "🚀";
      default:
        return "⏳";
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Cross-Chain Swap Interface
        </h1>
        <p className="text-gray-600">
          Secure ETH ↔ DOT swaps using 1inch Fusion+ and HTLC technology
        </p>
        <div className="mt-4">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              isConnected
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Swap Form */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Initiate Swap</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Swap Direction
              </label>
              <select
                name="direction"
                value={formData.direction}
                onChange={handleInputChange}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="eth-to-dot">ETH → DOT</option>
                <option value="dot-to-eth">DOT → ETH</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount ({formData.direction === "eth-to-dot" ? "ETH" : "DOT"})
              </label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                placeholder={
                  formData.direction === "eth-to-dot" ? "0.01" : "10"
                }
                step="0.001"
                min="0"
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sender Address (
                {formData.direction === "eth-to-dot" ? "Ethereum" : "Polkadot"})
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  name="senderAddress"
                  value={formData.senderAddress}
                  onChange={handleInputChange}
                  placeholder={
                    formData.direction === "eth-to-dot" ? "0x..." : "5G..."
                  }
                  className="flex-1 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {formData.direction === "eth-to-dot" && (
                  <button
                    onClick={connectWallet}
                    className="px-4 py-3 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Recipient Address (
                {formData.direction === "eth-to-dot" ? "Polkadot" : "Ethereum"})
              </label>
              <input
                type="text"
                name="recipientAddress"
                value={formData.recipientAddress}
                onChange={handleInputChange}
                placeholder={
                  formData.direction === "eth-to-dot" ? "5G..." : "0x..."
                }
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {swapStatus.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800 text-sm">{swapStatus.error}</p>
              </div>
            )}

            <button
              onClick={initiateSwap}
              disabled={!isConnected || swapStatus.isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-md hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {swapStatus.isLoading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                `Initiate ${formData.direction.toUpperCase()} Swap`
              )}
            </button>
          </div>
        </div>

        {/* Current Swap Status */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Current Swap Status</h2>

          {swapStatus.swap ? (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Swap ID:</span>
                  <span className="text-sm font-mono bg-white px-2 py-1 rounded">
                    {swapStatus.swap.swapId.substring(0, 10)}...
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Direction:</span>
                  <span className="capitalize">
                    {swapStatus.swap.direction}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Status:</span>
                  <span
                    className={`flex items-center space-x-1 ${getStatusColor(
                      swapStatus.swap.status
                    )}`}
                  >
                    <span>{getStatusIcon(swapStatus.swap.status)}</span>
                    <span className="capitalize">{swapStatus.swap.status}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Created:</span>
                  <span className="text-sm">
                    {new Date(swapStatus.swap.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Escrow Information */}
              {(swapStatus.swap.ethEscrow || swapStatus.swap.dotEscrow) && (
                <div className="space-y-2">
                  <h3 className="font-medium">Escrow Contracts:</h3>
                  {swapStatus.swap.ethEscrow && (
                    <div className="p-3 bg-blue-50 rounded border">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Ethereum:</span>
                        <span
                          className={
                            swapStatus.swap.ethEscrow.withdrawn
                              ? "text-green-600"
                              : "text-gray-600"
                          }
                        >
                          {swapStatus.swap.ethEscrow.withdrawn
                            ? "✅ Withdrawn"
                            : "🔒 Locked"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {swapStatus.swap.ethEscrow.contractId.substring(0, 20)}
                        ...
                      </div>
                    </div>
                  )}
                  {swapStatus.swap.dotEscrow && (
                    <div className="p-3 bg-purple-50 rounded border">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Polkadot:</span>
                        <span
                          className={
                            swapStatus.swap.dotEscrow.withdrawn
                              ? "text-green-600"
                              : "text-gray-600"
                          }
                        >
                          {swapStatus.swap.dotEscrow.withdrawn
                            ? "✅ Withdrawn"
                            : "🔒 Locked"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {swapStatus.swap.dotEscrow.contractId.substring(0, 20)}
                        ...
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              <div className="text-4xl mb-2">🔄</div>
              <p>No active swap</p>
              <p className="text-sm">Initiate a swap to see status here</p>
            </div>
          )}
        </div>
      </div>

      {/* Active Swaps List */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4">
          All Active Swaps ({activeSwaps.length})
        </h2>

        {activeSwaps.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Swap ID</th>
                  <th className="text-left py-2">Direction</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Created</th>
                  <th className="text-left py-2">Escrows</th>
                </tr>
              </thead>
              <tbody>
                {activeSwaps.map((swap) => (
                  <tr key={swap.swapId} className="border-b hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs">
                      {swap.swapId.substring(0, 10)}...
                    </td>
                    <td className="py-2 capitalize">{swap.direction}</td>
                    <td className={`py-2 ${getStatusColor(swap.status)}`}>
                      <span className="flex items-center space-x-1">
                        <span>{getStatusIcon(swap.status)}</span>
                        <span className="capitalize">{swap.status}</span>
                      </span>
                    </td>
                    <td className="py-2">
                      {new Date(swap.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      <div className="flex space-x-1">
                        {swap.ethEscrow && (
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              swap.ethEscrow.withdrawn
                                ? "bg-green-100 text-green-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            ETH
                          </span>
                        )}
                        {swap.dotEscrow && (
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              swap.dotEscrow.withdrawn
                                ? "bg-green-100 text-green-800"
                                : "bg-purple-100 text-purple-800"
                            }`}
                          >
                            DOT
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">📋</div>
            <p>No active swaps</p>
            <p className="text-sm">Swaps will appear here once initiated</p>
          </div>
        )}
      </div>

      {/* Activity Logs */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Activity Logs</h2>

        <div className="bg-gray-900 text-green-400 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
          {swapStatus.logs.length > 0 ? (
            swapStatus.logs.map((log, index) => (
              <div key={index} className="mb-1">
                {log}
              </div>
            ))
          ) : (
            <div className="text-gray-500">Waiting for activity...</div>
          )}
        </div>
      </div>
    </div>
  );
}
