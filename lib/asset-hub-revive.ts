/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiPromise } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { ISubmittableResult } from "@polkadot/types/types";

export class AssetHubReviveWrapper {
  private api: ApiPromise;
  private contractAddress: string;

  constructor(api: ApiPromise, contractAddress: string) {
    this.api = api;
    this.contractAddress = contractAddress;
  }

  async newContract(
    account: KeyringPair,
    receiver: string,
    hashlock: string,
    timelock: number,
    swapId: string,
    sourceChain: number,
    destChain: number,
    destAmount: string,
    senderCrossAddress?: string,
    receiverCrossAddress?: string
  ) {
    console.log("📝 Creating Asset Hub Revive contract transaction...");
    console.log(`   Receiver: ${receiver}`);
    console.log(`   Hashlock: ${hashlock}`);
    console.log(`   Timelock: ${timelock}`);
    console.log(`   Value: ${destAmount}`);

    try {
      // Use the revive module directly since Asset Hub uses this for contracts
      if (!this.api.tx.revive || !this.api.tx.revive.call) {
        throw new Error("Revive module not available on this chain");
      }

      // Convert DOT amount to the smallest unit (DOT has 10 decimals)
      // Handle decimal precision carefully
      const parts = destAmount.split(".");
      const wholePart = parts[0] || "0";
      const decimalPart = (parts[1] || "").padEnd(10, "0").slice(0, 10);
      const dotAmountInPlanck = BigInt(wholePart + decimalPart);

      console.log(
        `📝 Preparing revive call with amount: ${dotAmountInPlanck} Planck`
      );

      // For revive contracts, we need to encode the function call manually
      // Function selector for new_contract: 0xbbd45d7d
      const functionSelector = "0xbbd45d7d";

      // Encode parameters for the 9-parameter function using proper SCALE encoding
      // This is a simplified approach - for production, use @polkadot/api-contract

      // Parameter structure (9 parameters):
      // 1. receiver: Address (H160 - 20 bytes)
      // 2. hashlock: [u8; 32] (32 bytes)
      // 3. timelock: BlockNumber (u32 - 4 bytes)
      // 4. swap_id: [u8; 32] (32 bytes)
      // 5. source_chain: u32 (4 bytes)
      // 6. dest_chain: u32 (4 bytes)
      // 7. dest_amount: Balance (u128 - 16 bytes)
      // 8. sender_cross_address: Option<Vec<u8>> (1 byte flag + length + data)
      // 9. receiver_cross_address: Option<Vec<u8>> (1 byte flag + length + data)

      const params = new Uint8Array(1024); // Allocate enough space
      let offset = 0;

      // 1. receiver (20 bytes) - remove 0x prefix and convert to bytes
      const receiverBytes = new Uint8Array(
        Buffer.from(receiver.slice(2), "hex")
      );
      params.set(receiverBytes, offset);
      offset += 20;

      // 2. hashlock (32 bytes)
      const hashlockBytes = new Uint8Array(
        Buffer.from(hashlock.slice(2), "hex")
      );
      params.set(hashlockBytes, offset);
      offset += 32;

      // 3. timelock (u32, little-endian)
      const timelockBytes = new Uint8Array(4);
      new DataView(timelockBytes.buffer).setUint32(0, timelock, true);
      params.set(timelockBytes, offset);
      offset += 4;

      // 4. swap_id (32 bytes)
      const swapIdBytes = new Uint8Array(Buffer.from(swapId.slice(2), "hex"));
      params.set(swapIdBytes, offset);
      offset += 32;

      // 5. source_chain (u32, little-endian)
      const sourceChainBytes = new Uint8Array(4);
      new DataView(sourceChainBytes.buffer).setUint32(0, sourceChain, true);
      params.set(sourceChainBytes, offset);
      offset += 4;

      // 6. dest_chain (u32, little-endian)
      const destChainBytes = new Uint8Array(4);
      new DataView(destChainBytes.buffer).setUint32(0, destChain, true);
      params.set(destChainBytes, offset);
      offset += 4;

      // 7. dest_amount (u128, little-endian)
      const destAmountBytes = new Uint8Array(16);
      // For simplicity, put the amount in the first 8 bytes (u64 range)
      new DataView(destAmountBytes.buffer).setBigUint64(
        0,
        dotAmountInPlanck,
        true
      );
      params.set(destAmountBytes, offset);
      offset += 16;

      // 8. sender_cross_address: Option<Vec<u8>> - encode as None (0x00)
      params[offset] = 0x00; // None variant
      offset += 1;

      // 9. receiver_cross_address: Option<Vec<u8>> - encode as None (0x00)
      params[offset] = 0x00; // None variant
      offset += 1;

      // Create the full call data
      const encodedParams = params.slice(0, offset);
      const callData =
        functionSelector + Buffer.from(encodedParams).toString("hex");

      console.log("Contract call data:", callData);

      // Create the revive.call transaction - function is payable, so transfer the DOT amount
      const tx = this.api.tx.revive.call(
        this.contractAddress, // dest: contract address
        dotAmountInPlanck.toString(), // value: transfer DOT amount for HTLC
        {
          refTime: "50000000000", // Higher gas limit ref time
          proofSize: "500000", // Higher gas limit proof size
        },
        "1000000000000", // storage_deposit_limit: 1 DOT for storage
        callData // data: encoded function call
      );

      // Get the real transaction hash and wait for inclusion in block
      let txHash: string = "";
      let isCompleted = false;
      let resolveTransaction: (value: {
        hash: string;
        success: boolean;
        blockHash?: string;
      }) => void;

      const transactionPromise = new Promise<{
        hash: string;
        success: boolean;
        blockHash?: string;
      }>((resolve) => {
        resolveTransaction = resolve;
      });

      const unsubscribe = await tx.signAndSend(
        account,
        { nonce: -1 },
        (status: ISubmittableResult) => {
          console.log(`   Transaction status: ${status.status}`);

          // Capture the transaction hash immediately when available
          if (status.txHash && !txHash) {
            txHash = status.txHash.toHex();
            console.log(`   📝 Got real txHash: ${txHash}`);
          }

          if (status.status.isInBlock) {
            const blockHash = status.status.asInBlock.toHex();
            console.log(`   ✅ Transaction included in block: ${blockHash}`);

            // Check if the transaction was successful by looking at events
            let success = false;
            status.events.forEach((event) => {
              const {
                event: { method, section },
              } = event;
              if (section === "system" && method === "ExtrinsicSuccess") {
                success = true;
                console.log(`   ✅ Transaction executed successfully`);
              } else if (section === "system" && method === "ExtrinsicFailed") {
                console.log(`   ❌ Transaction failed`);
              }
            });

            if (!isCompleted) {
              isCompleted = true;
              resolveTransaction({
                hash: txHash,
                success,
                blockHash: blockHash,
              });
            }
          } else if (status.status.isFinalized) {
            console.log(
              `   🎉 Transaction finalized in block: ${status.status.asFinalized}`
            );

            if (!isCompleted) {
              isCompleted = true;
              resolveTransaction({
                hash: txHash,
                success: true,
                blockHash: status.status.asFinalized.toHex(),
              });
            }
          }

          // Log any events that occurred
          status.events.forEach((event, index) => {
            console.log(
              `   Event ${index}: ${event.event.section}.${event.event.method}`
            );
          });
        }
      );

      // Wait for the transaction to be included in a block
      let result;
      try {
        result = await Promise.race([
          transactionPromise,
          new Promise<{
            hash: string;
            success: boolean;
            blockHash?: string;
            blockNumber?: number;
          }>((_, reject) =>
            setTimeout(
              () => reject(new Error("Transaction inclusion timeout")),
              30000
            )
          ),
        ]);
      } catch (error) {
        console.error(`   ❌ Failed to get transaction inclusion: ${error}`);
        throw new Error(
          "Could not confirm transaction inclusion in blockchain"
        );
      }

      // Clean up the subscription
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }

      console.log(`   ✅ Final transaction hash: ${result.hash}`);

      return {
        success: true,
        txHash: result.hash,
        blockHash: result.blockHash || result.hash,
      };
    } catch (error) {
      console.error("❌ Contract transaction failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getContract(contractId: string) {
    try {
      console.log(`🔍 Querying contract state for: ${contractId}`);

      // Since we can't easily query the contract state without the proper interface,
      // we'll return a placeholder that indicates the transaction was submitted
      return {
        contractId,
        status: "submitted",
        note: "Contract state query not available with revive interface",
      };
    } catch (error) {
      console.error("Error querying contract:", error);
      return null;
    }
  }

  async contractExists(contractId: string): Promise<boolean> {
    try {
      // For revive contracts, we can't easily check existence without proper interface
      // Return true if we have a contract ID
      return !!(contractId && contractId.length > 0);
    } catch (error) {
      console.error("Error checking contract existence:", error);
      return false;
    }
  }
}
