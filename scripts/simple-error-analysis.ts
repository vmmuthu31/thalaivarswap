#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import dotenv from "dotenv";

dotenv.config();

async function analyzeError() {
  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";
  const blockHash =
    "0x01de0a34f3416873910b4422f144196e436602954861afbaba315d9873e04f22";

  console.log("🔍 Analyzing Failed DOT Transaction");
  console.log("===================================");

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    console.log("✅ Connected to network");

    // Get the block events
    const events = await api.query.system.events.at(blockHash);
    const eventsArray = events.toJSON() as Array<any>;

    console.log(`📋 Found ${eventsArray.length} events in block`);

    // Look for ExtrinsicFailed events
    eventsArray.forEach((eventRecord: any, index: number) => {
      const { event, phase } = eventRecord;

      if (
        event &&
        event.section === "system" &&
        event.method === "ExtrinsicFailed"
      ) {
        console.log(`\n❌ ExtrinsicFailed event found at index ${index}:`);
        console.log(`   Phase: ${JSON.stringify(phase)}`);
        console.log(`   Event data: ${JSON.stringify(event.data, null, 2)}`);

        // Try to decode the error
        if (event.data && event.data[0]) {
          const errorData = event.data[0];
          console.log(`\n🔍 Error Analysis:`);

          if (errorData.Module) {
            console.log(`   Module Error:`);
            console.log(`     Index: ${errorData.Module.index}`);
            console.log(`     Error: ${errorData.Module.error}`);

            // Common revive pallet errors
            if (errorData.Module.index === 64) {
              // Common revive pallet index
              const errorMessages = {
                0: "InvalidScheduleVersion",
                1: "InvalidCallFlags",
                2: "InvalidStorageDepositLimit",
                3: "InvalidCodeHash",
                4: "CodeNotFound",
                5: "ContractNotFound",
                6: "TokenNotFound",
                7: "InvalidDestination",
                8: "Reentrancy",
                9: "MaxCallDepthReached",
                10: "ContractTrapped",
                11: "ValueTooLarge",
                12: "TerminatedInConstructor",
                13: "DebugMessageInvalidUTF8",
                14: "StorageDepositNotEnoughFunds",
                15: "StorageDepositLimitExhausted",
                16: "CodeInUse",
                17: "ContractReverted",
                18: "CodeRejected",
                19: "Indeterministic",
              };

              const errorMsg =
                errorMessages[
                  errorData.Module.error as keyof typeof errorMessages
                ] || `Unknown error ${errorData.Module.error}`;
              console.log(`     Decoded: ${errorMsg}`);

              // Provide specific guidance
              if (errorData.Module.error === 14) {
                console.log(`\n💡 Fix: Insufficient funds for storage deposit`);
                console.log(`   - Increase account balance`);
                console.log(`   - Reduce storage deposit limit in transaction`);
              } else if (errorData.Module.error === 17) {
                console.log(`\n💡 Fix: Contract reverted`);
                console.log(`   - Check contract function parameters`);
                console.log(`   - Verify contract logic conditions`);
                console.log(`   - Check input validation in contract`);
              }
            }
          } else if (errorData.BadOrigin) {
            console.log(
              `   Bad Origin Error - check signing account permissions`
            );
          } else if (errorData.CannotLookup) {
            console.log(
              `   Cannot Lookup Error - check account/address format`
            );
          }
        }
      }
    });

    // Check current contract state
    console.log(`\n🔧 Contract State Check:`);
    const contractAddress = "0xc12c83c055b8250c3d50984ce21bf27dfec8896a";

    try {
      if (api.query.revive?.contractInfoOf) {
        const contractInfo = await api.query.revive.contractInfoOf(
          contractAddress
        );
        console.log(`   Contract exists: ${!contractInfo.isEmpty}`);
        if (!contractInfo.isEmpty) {
          console.log(`   Contract info: ${contractInfo.toString()}`);
        } else {
          console.log(`   ❌ Contract not found at address ${contractAddress}`);
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not query contract: ${error}`);
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Analysis failed:", error);
  }
}

analyzeError().catch(console.error);
