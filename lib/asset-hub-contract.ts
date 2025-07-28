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
    destAmount: string,
    senderCrossAddress?: string,
    receiverCrossAddress?: string
  ) {
    console.log("📝 Creating Asset Hub contract transaction...");
    console.log(`   Receiver: ${receiver}`);
    console.log(`   Hashlock: ${hashlock}`);
    console.log(`   Timelock: ${timelock}`);
    console.log(`   Value: ${destAmount}`);

    const tx = this.contract.tx.newContract(
      {
        gasLimit: -1, // Use automatic gas limit calculation
        storageDepositLimit: null, // No storage deposit limit
        value: destAmount,
      },
      receiver,
      hashlock,
      timelock,
      swapId,
      sourceChain,
      destChain,
      destAmount,
      senderCrossAddress ? [senderCrossAddress] : null,
      receiverCrossAddress ? [receiverCrossAddress] : null
    );

    try {
      const result = await tx.signAndSend(
        account,
        (status: ISubmittableResult) => {
          console.log(`   Transaction status: ${status.status}`);

          if (status.isInBlock) {
            console.log(
              `   ✅ Transaction included in block: ${status.status.asInBlock}`
            );
          } else if (status.isFinalized) {
            console.log(
              `   🎉 Transaction finalized in block: ${status.status.asFinalized}`
            );
          }
        }
      );

      return {
        success: true,
        txHash: result.toString(),
        blockHash: result,
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
      const { result, output } = await this.contract.query.getContract(
        contractId, // caller address - use first account or a dummy address
        {
          gasLimit: -1,
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
          gasLimit: -1,
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
