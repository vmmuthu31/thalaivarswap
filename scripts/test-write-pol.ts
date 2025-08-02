#!/usr/bin/env tsx

import * as dotenv from "dotenv";
dotenv.config();

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { ContractPromise } from "@polkadot/api-contract";
import fs from "fs";

// Helper: random 32 byte Uint8Array
function randomBytes(n = 32): Uint8Array {
    const arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
}

// Helper: convert AccountId hex to [u8; 32]
function accountIdToBytes(hex: string): Uint8Array {
    let h = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (h.length !== 64) {
        throw new Error("AccountId must be 32 bytes (64 hex chars)");
    }
    const arr = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        arr[i] = parseInt(h.substr(i * 2, 2), 16);
    }
    return arr;
}

// Helper: convert number to BigInt for ES2019 compatibility
function toBigInt(x: number): any {
    return BigInt(String(x));
}

async function testWriteFunctions() {
    console.log("✍️ Testing Polkadot Contract Write Functions...");

    await cryptoWaitReady();

    const wsProvider = new WsProvider(process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev");
    const api = await ApiPromise.create({ provider: wsProvider });

    const keyring = new Keyring({ type: "sr25519" });
    const alice = keyring.addFromUri(process.env.POLKADOT_SEED || "//Alice");
    const bob = keyring.addFromUri("//Bob");
    const charlie = keyring.addFromUri("//Charlie");

    const abiPath = process.env.POLKADOT_CONTRACT_ABI || "./lib/polkadotrelayer.json";
    if (!fs.existsSync(abiPath)) {
        console.error("❌ Missing contract ABI file at " + abiPath);
        process.exit(1);
    }
    const contractAbi = JSON.parse(fs.readFileSync(abiPath, "utf-8"));

    const contractAddress = process.env.POLKADOT_CONTRACT_ADDRESS || "";
    if (!contractAddress) {
        console.error("❌ POLKADOT_CONTRACT_ADDRESS not set");
        process.exit(1);
    }
    const contract = new ContractPromise(api, contractAbi, contractAddress);

    // Helper for contract tx
    async function contractTx(method: string, args: any[], value: any, signer: any) {
        return new Promise((resolve, reject) => {
            contract.tx[method]({ value, gasLimit: 200000000000 }, ...args)
                .signAndSend(signer, (result: any) => {
                    if (result.status.isInBlock || result.status.isFinalized) {
                        const events = result.events.filter(
                            ({ event }: { event: any }) => event.section === "contracts"
                        );
                        const errorEvent = events.find(
                            ({ event }: { event: any }) => event.method === "ContractExecutionFailed"
                        );
                        if (errorEvent) {
                            reject(new Error("Contract execution failed"));
                        } else {
                            resolve(result);
                        }
                    }
                })
                .catch(reject);
        });
    }

    // 1. mapAddress - Alice maps her Ethereum address
    console.log("\n1️⃣ Alice maps Ethereum cross-chain address");
    const ethAddr = Array(20).fill(0x42); // Demo address: 0x4242... (20 bytes)
    const crossChainEnum = { Ethereum: ethAddr };
    await contractTx("mapAddress", [crossChainEnum], 0, alice);
    console.log("   ✅ Alice mapped her Ethereum address");

    // 2. new_contract - Alice creates a new HTLC contract to Bob
    console.log("\n2️⃣ Alice creates HTLC contract to Bob");

    // Compose args (match contract types!)
    const receiver = accountIdToBytes(api.createType("AccountId", bob.address).toHex());   // [u8; 32]
    const hashlock = randomBytes(32);         // [u8; 32]
    const blockNumber = (await api.rpc.chain.getHeader()).number.toNumber();

    // Ensure timelock is well within allowed range
    const timelock = blockNumber + 2000;  // min_timelock: 100, max_timelock: 14400

    const swap_id = randomBytes(32);          // [u8; 32]
    const source_chain = 1;                   // u32
    const dest_chain = 2;                     // u32, must NOT equal source_chain
    const dest_amount = toBigInt(1000000000000); // Balance (u128), use large BigInt
    const sender_cross_address = [0xaa, 0xbb, 0xcc];
    const receiver_cross_address = [0xdd, 0xee, 0xff];

    // Debug: print all args
    console.log("\n===== DEBUG: contract call arguments =====");
    console.log({ receiver, hashlock, timelock, blockNumber, swap_id, source_chain, dest_chain, dest_amount, sender_cross_address, receiver_cross_address, value: "1000000000000" });

    const newContractArgs = [
        receiver,
        hashlock,
        timelock,
        swap_id,
        source_chain,
        dest_chain,
        dest_amount,
        sender_cross_address,
        receiver_cross_address
    ];
    // Send a large value to avoid InsufficientFunds errors
    const value = toBigInt(1000000000000);

    let contractId: string | undefined = undefined;
    try {
        const newContractResult: any = await contractTx("newContract", newContractArgs, value, alice);

        // Print all contract events for debug
        if (newContractResult && newContractResult.events) {
            console.log("All events for newContract:");
            for (const eventObj of newContractResult.events) {
                const event = eventObj.event as any;
                console.log(`[${event.section}.${event.method}]`, event.data.map((d: any) => d.toString()));
                if (event.method === "HTLCNew") {
                    // Print contractId in hex (should be [u8; 32])
                    const cid = event.data[0];
                    if (cid.toHex) {
                        contractId = cid.toHex();
                    } else if (cid instanceof Uint8Array || Array.isArray(cid)) {
                        const bytes = Array.from(cid as Uint8Array);
                        contractId = "0x" + bytes.map(function(x) {
                            return x.toString(16).padStart(2, "0");
                        }).join("");
                    } else {
                        contractId = String(cid);
                    }
                    console.log("HTLCNew event (hex):", contractId);
                }
            }
        }
        if (!contractId) {
            throw new Error("Could not retrieve contractId from HTLCNew event");
        }
        console.log("   ✅ Real contractId:", contractId);

        // 3. Register relayer (Charlie)
        console.log("\n3️⃣ Charlie registers as relayer for contract");
        await contractTx("registerRelayer", [accountIdToBytes(contractId)], 0, charlie);
        console.log("   ✅ Relayer registered");

        // 4. Withdraw funds (Bob or relayer)
        console.log("\n4️⃣ Bob withdraws with preimage");
        await contractTx("withdraw", [accountIdToBytes(contractId), hashlock], 0, bob);
        console.log("   ✅ Withdraw successful");

        // 5. Refund (Alice tries refund before timelock, should fail)
        console.log("\n5️⃣ Alice tries to refund before timelock, should fail");
        try {
            await contractTx("refund", [accountIdToBytes(contractId)], 0, alice);
            console.log("   ❌ Refund succeeded (unexpected)");
        } catch (e: any) {
            console.log("   ✅ Refund failed as expected:", e.message || e);
        }

        await api.disconnect();
        console.log("\n🎉 All write function tests completed!");
        console.log("   🟢 Use contractId above for your read tests!");

    } catch (err: any) {
        console.error("Fatal error:", err.message || err);
        await api.disconnect();
        process.exit(1);
    }
}

testWriteFunctions().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});