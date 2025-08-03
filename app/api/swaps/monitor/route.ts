import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

// Mock database for demo - in production use Firebase/PostgreSQL
const swapDatabase = new Map<string, any>();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const swapId = searchParams.get("swapId");

    if (action === "status" && swapId) {
      // Get specific swap status
      const swap = swapDatabase.get(swapId);

      if (!swap) {
        return NextResponse.json({ error: "Swap not found" }, { status: 404 });
      }

      // Check real transaction status
      const updatedSwap = await checkTransactionStatus(swap);
      swapDatabase.set(swapId, updatedSwap);

      return NextResponse.json({
        success: true,
        data: updatedSwap,
      });
    }

    if (action === "list") {
      // Get all swaps
      const allSwaps = Array.from(swapDatabase.values())
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        .slice(0, 20); // Last 20 swaps

      return NextResponse.json({
        success: true,
        data: allSwaps,
      });
    }

    if (action === "stats") {
      // Get swap statistics
      const allSwaps = Array.from(swapDatabase.values());
      const totalSwaps = allSwaps.length;
      const completedSwaps = allSwaps.filter(
        (s) => s.status === "completed"
      ).length;
      const failedSwaps = allSwaps.filter((s) => s.status === "failed").length;
      const pendingSwaps = allSwaps.filter(
        (s) => s.status === "pending"
      ).length;

      const totalVolume = allSwaps
        .filter((s) => s.status === "completed")
        .reduce((sum, s) => sum + parseFloat(s.amount || "0"), 0);

      return NextResponse.json({
        success: true,
        data: {
          totalSwaps,
          completedSwaps,
          failedSwaps,
          pendingSwaps,
          successRate:
            totalSwaps > 0
              ? ((completedSwaps / totalSwaps) * 100).toFixed(1) + "%"
              : "0%",
          totalVolume: totalVolume.toFixed(4),
          recentSwaps: allSwaps.slice(0, 5),
        },
      });
    }

    return NextResponse.json(
      { error: "Invalid action parameter" },
      { status: 400 }
    );
  } catch (error) {
    console.error("❌ Monitor API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { swapId, ...swapData } = body;

    if (!swapId) {
      return NextResponse.json(
        { error: "Swap ID is required" },
        { status: 400 }
      );
    }

    // Process and normalize the swap data
    const swap = {
      ...swapData,
      swapId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Extract transaction hashes for proper display
    if (swapData.details) {
      if (swapData.details.ethTxHash) {
        swap.ethTransaction = {
          hash: swapData.details.ethTxHash,
          blockNumber: swapData.details.ethBlockNumber,
          status: "confirmed",
          gasUsed: swapData.details.gasUsed || "0",
        };
      }

      if (swapData.details.polkadotTxHash) {
        swap.polkadotTransaction = {
          hash: swapData.details.polkadotTxHash,
          blockNumber: swapData.details.polkadotBlock,
          status: "confirmed",
        };
      }

      // Enhanced error analysis for failed transactions
      if (swapData.status === "failed" && swapData.details.error) {
        swap.failureAnalysis = analyzeTransactionFailure(
          swapData.details.error
        );
      }
    }

    swapDatabase.set(swapId, swap);

    console.log(`📊 Stored swap in monitor: ${swapId} - ${swap.status}`);

    // If transaction failed, log detailed analysis
    if (swap.status === "failed" && swap.failureAnalysis) {
      console.log(`🔍 Failure analysis for ${swapId}:`, swap.failureAnalysis);
    }

    return NextResponse.json({
      success: true,
      data: swap,
    });
  } catch (error) {
    console.error("❌ Monitor POST error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

async function checkTransactionStatus(swap: any) {
  try {
    if (!swap.txHash && !swap.details?.ethTxHash) {
      return swap;
    }

    const txHash = swap.txHash || swap.details?.ethTxHash;

    // Check Ethereum transaction status
    if (swap.direction === "eth-to-dot" || txHash?.startsWith("0x")) {
      const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);

      try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (receipt) {
          const currentBlock = await provider.getBlockNumber();
          const confirmations = currentBlock - receipt.blockNumber;

          swap.ethTransaction = {
            hash: txHash,
            blockNumber: receipt.blockNumber,
            status: receipt.status === 1 ? "confirmed" : "failed",
            gasUsed: receipt.gasUsed.toString(),
            confirmations,
            gasPrice: receipt.gasPrice?.toString() || "0",
          };

          // If transaction failed, get more details
          if (receipt.status === 0) {
            swap.status = "failed";

            // Try to get the original transaction for more context
            try {
              const tx = await provider.getTransaction(txHash);
              if (tx) {
                swap.ethTransaction.value = tx.value.toString();
                swap.ethTransaction.gasLimit = tx.gasLimit.toString();

                // Try to simulate the transaction to get revert reason
                try {
                  await provider.call({
                    to: tx.to,
                    data: tx.data,
                    value: tx.value,
                    from: tx.from,
                  });
                } catch (callError: any) {
                  swap.failureAnalysis = {
                    ...analyzeTransactionFailure(callError.message),
                    revertReason: extractRevertReason(callError),
                  };
                }
              }
            } catch (txError) {
              console.warn("Could not fetch transaction details:", txError);
            }
          } else if (receipt.status === 1 && swap.status === "pending") {
            swap.status = "processing"; // ETH confirmed, waiting for DOT
          }
        } else {
          // Transaction not found or still pending
          if (swap.status !== "failed") {
            swap.status = "pending";
          }
        }
      } catch (ethError: any) {
        console.warn("ETH transaction check failed:", ethError);

        // If it's a transaction not found error, mark as pending
        if (
          ethError.code === "NETWORK_ERROR" ||
          ethError.message?.includes("not found")
        ) {
          swap.status = "pending";
        }
      }
    }

    // For Polkadot transactions, we'd check via Polkadot API
    // For now, simulate the check
    if (swap.details?.polkadotTxHash) {
      swap.polkadotTransaction = {
        hash: swap.details.polkadotTxHash,
        status: "confirmed",
        blockNumber: 877941, // Simulated
      };

      if (swap.status === "processing") {
        swap.status = "completed"; // Both sides confirmed
      }
    }

    swap.updatedAt = new Date().toISOString();
    return swap;
  } catch (error) {
    console.error("Transaction status check failed:", error);
    return swap;
  }
}

function analyzeTransactionFailure(errorMessage: string) {
  const analysis = {
    category: "unknown",
    reason: "Transaction failed",
    suggestion: "Please try again or contact support",
    technical: errorMessage,
  };

  if (errorMessage.includes("insufficient funds")) {
    analysis.category = "insufficient_funds";
    analysis.reason = "Insufficient ETH balance for transaction";
    analysis.suggestion = "Add more ETH to your wallet to cover gas fees";
  } else if (errorMessage.includes("gas")) {
    analysis.category = "gas_issue";
    analysis.reason = "Gas-related transaction failure";
    analysis.suggestion = "Try increasing gas limit or gas price";
  } else if (errorMessage.includes("nonce")) {
    analysis.category = "nonce_issue";
    analysis.reason = "Transaction nonce conflict";
    analysis.suggestion = "Wait for pending transactions to complete";
  } else if (errorMessage.includes("revert")) {
    analysis.category = "contract_revert";
    analysis.reason = "Smart contract rejected the transaction";
    analysis.suggestion = "Check contract conditions and try again";
  } else if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("network")
  ) {
    analysis.category = "network_issue";
    analysis.reason = "Network connectivity problem";
    analysis.suggestion = "Check your internet connection and try again";
  } else if (errorMessage.includes("replacement")) {
    analysis.category = "replacement_issue";
    analysis.reason = "Transaction was replaced or cancelled";
    analysis.suggestion = "Submit a new transaction";
  }

  return analysis;
}

function extractRevertReason(error: any): string {
  try {
    if (error.data) {
      // Try to decode revert reason from error data
      const errorData = error.data;
      if (typeof errorData === "string" && errorData.length > 10) {
        // Standard revert reason is encoded as Error(string)
        // Selector: 0x08c379a0
        if (errorData.startsWith("0x08c379a0")) {
          try {
            const reason = ethers.AbiCoder.defaultAbiCoder().decode(
              ["string"],
              "0x" + errorData.slice(10)
            );
            return reason[0];
          } catch {
            return "Unknown revert reason";
          }
        }
      }
    }

    if (error.reason) {
      return error.reason;
    }

    return "No revert reason available";
  } catch {
    return "Could not extract revert reason";
  }
}
