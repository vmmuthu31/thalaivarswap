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
          refTime: this.api.registry.createType('Compact<u64>', 50_000_000_000), // 50B gas limit for contract creation
          proofSize: this.api.registry.createType('Compact<u64>', 50_000_000),   // 50M proof size
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
        .then((unsub: any) => {
          unsubscribe = unsub;
        })
        .catch((error: any) => {
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

  async getContract(contractId: string, callerAddress?: string) {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      const { result, output } = await this.contract.query.getContract(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId
      );

      if (result.isOk) {
        return output?.toJSON();
      } else {
        const error = result.asErr;
        console.warn("Contract query failed:", error.toHuman());
        return null;
      }
    } catch (error) {
      console.error("Error querying contract:", error);
      return null;
    }
  }

  async contractExists(contractId: string, callerAddress?: string): Promise<boolean> {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      const { result, output } = await this.contract.query.contractExists(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000),
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

  async getSecret(contractId: string, callerAddress?: string) {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      const { result, output } = await this.contract.query.getSecret(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId
      );

      if (result.isOk) {
        return output?.toJSON();
      } else {
        const error = result.asErr;
        console.warn("Get secret query failed:", error.toHuman());
        return null;
      }
    } catch (error) {
      console.error("Error querying secret:", error);
      return null;
    }
  }

  async getCrossAddress(account: string, callerAddress?: string) {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      const { result, output } = await this.contract.query.getCrossAddress(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        account
      );

      if (result.isOk) {
        return output?.toJSON();
      } else {
        const error = result.asErr;
        console.warn("Get cross address query failed:", error.toHuman());
        return null;
      }
    } catch (error) {
      console.error("Error querying cross address:", error);
      return null;
    }
  }

  async getAdmin(callerAddress?: string) {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      console.log(`   Calling getAdmin with caller: ${caller}`);
      
      const { result, output } = await this.contract.query.getAdmin(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000), // 1B gas units
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000), // 1M proof size
          }) as any,
          storageDepositLimit: null,
        }
        // No parameters for getAdmin
      );

      console.log(`   Query result isOk: ${result.isOk}`);
      
      if (result.isOk) {
        const adminData = output?.toJSON();
        console.log(`   Raw output: ${JSON.stringify(adminData)}`);
        
        // Try to decode as hex address if it's an array of bytes
        if (Array.isArray(adminData)) {
          const hexAddress = '0x' + adminData.map((b: any) => (b as number).toString(16).padStart(2, '0')).join('');
          console.log(`   Hex address: ${hexAddress}`);
          
          // Try to convert to SS58 format
          try {
            const ss58Address = this.api.createType('AccountId', hexAddress).toString();
            console.log(`   SS58 address: ${ss58Address}`);
            return { raw: adminData, hex: hexAddress, ss58: ss58Address };
          } catch (e) {
            console.log(`   Could not convert to SS58: ${e}`);
            return { raw: adminData, hex: hexAddress };
          }
        }
        
        return adminData;
      } else {
        const error = result.asErr;
        console.warn("Get admin query failed:", error.toHuman());
        
        // Try to decode the error more specifically
        if (error.isModule) {
          const moduleError = error.asModule;
          console.warn("Module error details:", {
            index: moduleError.index.toString(),
            error: moduleError.error.toString()
          });
        }
        
        return null;
      }
    } catch (error) {
      console.error("Error querying admin:", error);
      return null;
    }
  }

  async getProtocolFeeBps(callerAddress?: string) {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      const { result, output } = await this.contract.query.getProtocolFeeBps(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000),
          }) as any,
          storageDepositLimit: null,
        }
        // No parameters for getProtocolFeeBps
      );

      if (result.isOk) {
        return output?.toJSON();
      } else {
        const error = result.asErr;
        console.warn("Get protocol fee BPS query failed:", error.toHuman());
        return null;
      }
    } catch (error) {
      console.error("Error querying protocol fee BPS:", error);
      return null;
    }
  }

  async getProtocolFees(callerAddress?: string) {
    try {
      // Use a default caller address if none provided
      const caller = callerAddress || "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"; // Alice's address
      
      const { result, output } = await this.contract.query.getProtocolFees(
        caller,
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 1_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 1_000_000),
          }) as any,
          storageDepositLimit: null,
        }
      );

      if (result.isOk) {
        return output?.toJSON();
      } else {
        const error = result.asErr;
        console.warn("Get protocol fees query failed:", error.toHuman());
        return null;
      }
    } catch (error) {
      console.error("Error querying protocol fees:", error);
      return null;
    }
  }

  // Write functions
  async mapAddress(account: KeyringPair, crossAddress: any) {
    try {
      console.log("📝 Mapping cross-chain address...");
      
      const tx = this.contract.tx.mapAddress(
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 50_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 50_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        crossAddress
      );

      return this.executeTransaction(tx, account, "mapAddress");
    } catch (error) {
      console.error("❌ mapAddress failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async registerRelayer(account: KeyringPair, contractId: string) {
    try {
      console.log("📝 Registering as relayer...");
      
      const tx = this.contract.tx.registerRelayer(
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 50_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 50_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId
      );

      return this.executeTransaction(tx, account, "registerRelayer");
    } catch (error) {
      console.error("❌ registerRelayer failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async withdraw(account: KeyringPair, contractId: string, preimage: string) {
    try {
      console.log("📝 Withdrawing from contract...");
      
      const tx = this.contract.tx.withdraw(
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 50_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 50_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId,
        preimage
      );

      return this.executeTransaction(tx, account, "withdraw");
    } catch (error) {
      console.error("❌ withdraw failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async refund(account: KeyringPair, contractId: string) {
    try {
      console.log("📝 Refunding contract...");
      
      const tx = this.contract.tx.refund(
        {
          gasLimit: this.api.registry.createType('WeightV2', {
            refTime: this.api.registry.createType('Compact<u64>', 50_000_000_000),
            proofSize: this.api.registry.createType('Compact<u64>', 50_000_000),
          }) as any,
          storageDepositLimit: null,
        },
        contractId
      );

      return this.executeTransaction(tx, account, "refund");
    } catch (error) {
      console.error("❌ refund failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Helper function to execute transactions
  private async executeTransaction(tx: any, account: KeyringPair, operation: string) {
    try {
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
            console.log(`   📝 ${operation} transaction hash: ${txHash}`);
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
              console.error(`   ❌ ${operation} failed with events:`);
              failedEvents.forEach((failedEvent, index) => {
                const { event } = failedEvent;
                console.error(`     Event ${index}:`, event.toHuman());
              });
              
              if (!isCompleted) {
                isCompleted = true;
                resolve({
                  success: false,
                  txHash,
                  error: `${operation} failed during execution: ${failedEvents.map(e => e.event.toHuman()).join(', ')}`
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
        .then((unsub: any) => {
          unsubscribe = unsub;
        })
        .catch((error: any) => {
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
            reject(new Error(`${operation} transaction timeout after 30 seconds`));
          }
        }, 30000);
      });

      const result = await transactionPromise;
      return result;
    } catch (error) {
      console.error(`❌ ${operation} transaction failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
