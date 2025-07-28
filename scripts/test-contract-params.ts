#!/usr/bin/env ts-node

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

async function testContractCallDryRun() {
  await cryptoWaitReady();

  const wsUrl =
    process.env.POLKADOT_WS_URL || "wss://testnet-passet-hub.polkadot.io";
  const contractAddress = "0xc12c83c055b8250c3d50984ce21bf27dfec8896a";

  console.log("🧪 Testing Contract Call (Dry Run)");
  console.log("==================================");

  try {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({
      provider: wsProvider,
      noInitWarn: true,
    });

    const keyring = new Keyring({ type: "sr25519" });
    const account = keyring.addFromUri("//Alice");

    console.log("✅ Connected to network");
    console.log(`📋 Contract: ${contractAddress}`);
    console.log(`👤 Account: ${account.address}`);

    // Check account balance
    const accountInfo = await api.query.system.account(account.address);
    const balance = accountInfo.data.free.toBn();
    console.log(`💰 Balance: ${ethers.formatEther(balance.toString())} DOT`);

    // Test contract parameters (same as in failing transaction)
    const receiver = "0x27E3FfEe60f242A9296Aa4780989E4bE74d680de";
    const hashlock =
      "0x923523ab1e5f0b99179a8b3179f2d4dec2c5910581d21b7cf071dc826cdbf909";
    const timelock = 803479;
    const swapId =
      "0x2098649a2b59e19aea7ff7724e21461ffcac264a7c55fa06e7b2d88dc388951";
    const sourceChain = 1000;
    const destChain = 1;
    const destAmount = "0.01";

    // Encode the call data (same as working version)
    const abiCoder = new ethers.AbiCoder();
    const encodedArgs = abiCoder.encode(
      [
        "address",
        "bytes32",
        "uint256",
        "bytes32",
        "uint32",
        "uint32",
        "uint256",
        "bytes",
        "bytes",
      ],
      [
        receiver,
        hashlock,
        timelock,
        swapId,
        sourceChain,
        destChain,
        ethers.parseEther(destAmount),
        "0x",
        "0x",
      ]
    );

    const functionSelector = "0xbbd45d7d";
    const callData = functionSelector + encodedArgs.substring(2);

    console.log(`📝 Call data: ${callData.substring(0, 50)}...`);

    // Test different parameter combinations
    const testCases = [
      {
        name: "Original parameters",
        value: ethers.parseEther(destAmount),
        gasLimit: { refTime: "10000000000", proofSize: "100000" },
        storageDepositLimit: ethers.parseEther("1"),
      },
      {
        name: "Higher gas limit",
        value: ethers.parseEther(destAmount),
        gasLimit: { refTime: "50000000000", proofSize: "500000" },
        storageDepositLimit: ethers.parseEther("1"),
      },
      {
        name: "Lower storage deposit",
        value: ethers.parseEther(destAmount),
        gasLimit: { refTime: "50000000000", proofSize: "500000" },
        storageDepositLimit: ethers.parseEther("0.1"),
      },
      {
        name: "No value transfer",
        value: 0,
        gasLimit: { refTime: "50000000000", proofSize: "500000" },
        storageDepositLimit: ethers.parseEther("0.1"),
      },
      {
        name: "Null storage deposit",
        value: 0,
        gasLimit: { refTime: "50000000000", proofSize: "500000" },
        storageDepositLimit: null,
      },
    ];

    for (const testCase of testCases) {
      console.log(`\n🧪 Testing: ${testCase.name}`);

      try {
        const dryRunResult = await api.call.revive.call(
          account.address, // origin
          contractAddress, // dest
          testCase.value, // value
          testCase.gasLimit, // gasLimit
          testCase.storageDepositLimit, // storageDepositLimit
          callData // data
        );

        const result = dryRunResult.toHuman() as any;
        console.log(`   Result: ${result.result || "Success"}`);

        if (result.gasConsumed) {
          console.log(`   Gas consumed: ${JSON.stringify(result.gasConsumed)}`);
        }

        if (result.gasRequired) {
          console.log(`   Gas required: ${JSON.stringify(result.gasRequired)}`);
        }

        if (result.storageDeposit) {
          console.log(
            `   Storage deposit: ${JSON.stringify(result.storageDeposit)}`
          );
        }

        if (result.debugMessage) {
          console.log(`   Debug: ${result.debugMessage}`);
        }

        if (result.result && result.result.Err) {
          console.log(`   ❌ Error: ${JSON.stringify(result.result.Err)}`);
        } else {
          console.log(`   ✅ Success!`);
          break; // Found working parameters
        }
      } catch (error) {
        console.log(`   ❌ Call failed: ${error}`);
      }
    }

    await api.disconnect();
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testContractCallDryRun().catch(console.error);
