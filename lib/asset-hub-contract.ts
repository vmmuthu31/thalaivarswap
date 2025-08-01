import { ApiPromise } from "@polkadot/api";
import { ContractPromise } from "@polkadot/api-contract";
import { KeyringPair } from "@polkadot/keyring/types";
import { ISubmittableResult } from "@polkadot/types/types";
import contractMetadata from "./polkadotrelayer.json";

export class AssetHubContractWrapper {
  private contract: ContractPromise;
  private api: ApiPromise;

  constructor(api: ApiPromise, contractAddress: string) {
    this.api = api;
    this.contract = new ContractPromise(api, contractMetadata, contractAddress);
  }

  async newContract(
    account: KeyringPair,
    receiver: string,
    hashlock: string,
    timelock: number,
    swapId: string,
    sourceChain: number,
    destChain: number,
    destAmount: string
  ) {
    console.log("📝 Creating Asset Hub contract transaction...");
    console.log(`   Receiver: ${receiver}`);
    console.log(`   Hashlock: ${hashlock}`);
    console.log(`   Timelock: ${timelock}`);
    console.log(`   Value: ${destAmount}`);

    // Convert address to 32-byte Address format expected by the contract
    let receiverAddress: string;
    if (receiver.startsWith('0x') && receiver.length === 42) {
      // Ethereum address - pad to 32 bytes
      const ethAddress = receiver.slice(2); // Remove 0x prefix
      receiverAddress = '0x' + ethAddress.padStart(64, '0'); // Pad to 32 bytes
      console.log(`   Converted Ethereum address: ${receiverAddress}`);
    } else if (receiver.length > 40) {
      // Polkadot address - decode to bytes
      try {
        const decoded = this.api.createType('AccountId', receiver);
        receiverAddress = decoded.toHex();
        console.log(`   Converted Polkadot address: ${receiverAddress}`);
      } catch (error) {
        console.warn(`   Failed to decode Polkadot address, using as-is: ${error}`);
        receiverAddress = receiver;
      }
    } else {
      receiverAddress = receiver;
    }

    const tx = this.contract.tx.newContract(
      {
        gasLimit: this.api.registry.createType('WeightV2', {
          refTime: this.api.registry.createType('Compact<u64>', 20_000_000), // Increased gas limit for contract creation
          proofSize: this.api.registry.createType('Compact<u64>', 20_000),   // Increased proof size
        }) as any,
        storageDepositLimit: null, // No storage deposit limit
        value: destAmount,
      },
      receiverAddress,
      hashlock,
      timelock,
      swapId,
      sourceChain,
      destChain,
      destAmount,
      null, // sender_cross_address (optional)
      null  // receiver_cross_address (optional)
    );

    try {
      // Create a promise that resolves when the transaction is included in a block
      const transactionPromise = new Promise<{
        success: boolean;
        txHash: string;
        blockHash?: string;
        error?: string;
      }>((resolve, reject) => {
        let unsubscribe: (() => void) | undefined;
        let txHash = "";
        let isCompleted = false;

        tx.signAndSend(account, (result: ISubmittableResult) => {
          // Capture transaction hash
          if (result.txHash && !txHash) {
            txHash = result.txHash.toHex();
            console.log(`   📝 Transaction hash: ${txHash}`);
          }

          console.log(`   Transaction status: ${result.status.type}`);

          if (result.status.isInBlock) {
            console.log(
              `   ✅ Transaction included in block: ${result.status.asInBlock.toHex()}`
            );

            // Check for any failed events
            const failedEvents = result.events.filter(({ event }) =>
              this.api.events.system.ExtrinsicFailed.is(event)
            );

            if (failedEvents.length > 0) {
              console.error("   ❌ Transaction failed with events:");
              failedEvents.forEach((failedEvent, index) => {
                const { event } = failedEvent;
                console.error(`     Event ${index}:`, event.toHuman());
                
                // Try to decode the error details
                if (event.data && event.data.length > 0) {
                  const errorData = event.data[0];
                  console.error(`     Error data:`, errorData.toHuman());
                }
              });
              
              if (!isCompleted) {
                isCompleted = true;
                resolve({
                  success: false,
                  txHash,
                  error: `Transaction failed during execution: ${failedEvents.map(e => e.event.toHuman()).join(', ')}`
                });
              }
              return;
            }

            // Transaction succeeded
            if (!isCompleted) {
              isCompleted = true;
              resolve({
                success: true,
                txHash,
                blockHash: result.status.asInBlock.toHex()
              });
            }
          } else if (result.status.isFinalized) {
            console.log(
              `   🎉 Transaction finalized in block: ${result.status.asFinalized.toHex()}`
            );

            if (!isCompleted) {
              isCompleted = true;
              resolve({
                success: true,
                txHash,
                blockHash: result.status.asFinalized.toHex()
              });
            }
          }

          // Log any events that occurred
          result.events.forEach((event, index) => {
            console.log(
              `   Event ${index}: ${event.event.section}.${event.event.method}`
            );
          });
        })
        .then((unsub) => {
          unsubscribe = unsub;
        })
        .catch((error) => {
          if (!isCompleted) {
            isCompleted = true;
            reject(error);
          }
        });

        // Set a timeout for the transaction
        setTimeout(() => {
          if (!isCompleted) {
            isCompleted = true;
            if (unsubscribe) unsubscribe();
            reject(new Error("Transaction timeout after 30 seconds"));
          }
        }, 30000);
      });

      const result = await transactionPromise;
      return result;
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
      const { result, output } = await this.contract.query.getContract(
        contractId, // caller address - use first account or a dummy address
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 10_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 10_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId
      );

      if (result.isOk) {
        return output?.toJSON();
      } else {
        console.warn("Contract query failed:", result.asErr);
        return null;
      }
    } catch (error) {
      console.error("Error querying contract:", error);
      return null;
    }
  }

  async contractExists(contractId: string): Promise<boolean> {
    try {
      const { result, output } = await this.contract.query.contractExists(
        contractId, // caller address
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 10_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 10_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId
      );

      if (result.isOk) {
        return output?.toJSON() as boolean;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Error checking contract existence:", error);
      return false;
    }
  }
}
