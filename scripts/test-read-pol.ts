#!/usr/bin/env tsx

import * as dotenv from "dotenv";
dotenv.config();

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { ContractPromise } from "@polkadot/api-contract";
import fs from "fs";

// Mapping ABI names to JS method names
const queryMethods = {
    get_admin: "getAdmin",
    get_protocol_fee_bps: "getProtocolFeeBps",
    get_protocol_fees: "getProtocolFees",
    get_min_timelock: "getMinTimelock",
    get_max_timelock: "getMaxTimelock",
    get_current_block: "getCurrentBlock",
    contract_exists: "contractExists",
    get_contract: "getContract",
    get_secret: "getSecret",
    get_cross_address: "getCrossAddress",
    debug_validate_contract_params: "debugValidateContractParams",
    debug_timelock_validation: "debugTimelockValidation"
} as const;

type QueryMethod = keyof typeof queryMethods;

function fmtHex(val: any) {
    if (!val) return "null";
    if (typeof val === "string") return val;
    if (val.toHex) return val.toHex();
    return JSON.stringify(val);
}

async function testReadFunctions() {
    console.log("🔍 Testing Polkadot Contract Read Functions...");

    await cryptoWaitReady();

    const wsProvider = new WsProvider(process.env.POLKADOT_WS_URL || "wss://ws.test.azero.dev");
    const api = await ApiPromise.create({ provider: wsProvider });
    const keyring = new Keyring({ type: "sr25519" });
    const alice = keyring.addFromUri(process.env.POLKADOT_SEED || "//Alice");
    const bob = keyring.addFromUri("//Bob");

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

    // Print available query methods for debugging:
    console.log("Available contract.query methods:", Object.keys(contract.query));

    const testContractId = "0x" + "11".repeat(32); // replace with known contract id

    async function contractQuery(method: QueryMethod, args: any[], caller: any = alice) {
        const jsMethod = queryMethods[method];
        if (!jsMethod || typeof contract.query[jsMethod] !== 'function') {
            return `Method ${jsMethod} not found on contract.query`;
        }
        try {
            const { output } = await contract.query[jsMethod](caller.address, { gasLimit: 100000000000 }, ...args);
            return output?.toHuman();
        } catch (e) {
            return `Error: ${e}`;
        }
    }

    // 1. get_admin
    console.log("\n1️⃣ get_admin");
    const admin = await contractQuery("get_admin", []);
    console.log("   Admin:", fmtHex(admin));

    // 2. get_protocol_fee_bps
    console.log("\n2️⃣ get_protocol_fee_bps");
    const feeBps = await contractQuery("get_protocol_fee_bps", []);
    console.log("   Protocol fee (bps):", feeBps);

    // 3. get_protocol_fees
    console.log("\n3️⃣ get_protocol_fees");
    const protocolFees = await contractQuery("get_protocol_fees", []);
    console.log("   Protocol fees accumulated:", protocolFees);

    // 4. get_min_timelock
    console.log("\n4️⃣ get_min_timelock");
    const minTimelock = await contractQuery("get_min_timelock", []);
    console.log("   Min timelock:", minTimelock);

    // 5. get_max_timelock
    console.log("\n5️⃣ get_max_timelock");
    const maxTimelock = await contractQuery("get_max_timelock", []);
    console.log("   Max timelock:", maxTimelock);

    // 6. get_current_block
    console.log("\n6️⃣ get_current_block");
    const blockNum = await contractQuery("get_current_block", []);
    console.log("   Current block:", blockNum);

    // 7. contract_exists
    console.log("\n7️⃣ contract_exists (testContractId)");
    const exists = await contractQuery("contract_exists", [testContractId]);
    console.log("   Exists:", exists);

    // 8. get_contract
    console.log("\n8️⃣ get_contract (testContractId)");
    const contractDetails = await contractQuery("get_contract", [testContractId]);
    console.log("   Details:", JSON.stringify(contractDetails, null, 2));

    // 9. get_secret
    console.log("\n9️⃣ get_secret (testContractId)");
    const secret = await contractQuery("get_secret", [testContractId]);
    console.log("   Secret:", fmtHex(secret));

    // 10. get_cross_address (for Alice)
    console.log("\n🔟 get_cross_address (alice)");
    const aliceHex = api.createType("AccountId", alice.address).toHex();
    const crossAddress = await contractQuery("get_cross_address", [aliceHex]);
    console.log("   Alice cross address:", JSON.stringify(crossAddress));

    // 11. debug_validate_contract_params
    console.log("\n1️⃣1️⃣ debug_validate_contract_params (timelock, source_chain, dest_chain)");
    const blockNumber = (await api.rpc.chain.getHeader()).number.toNumber();
    const debugValid = await contractQuery("debug_validate_contract_params", [blockNumber + 1000, 1, 2]);
    console.log("   Validate contract params:", debugValid);

    // 12. debug_timelock_validation
    console.log("\n1️⃣2️⃣ debug_timelock_validation (timelock)");
    const debugTime = await contractQuery("debug_timelock_validation", [blockNumber + 1000]);
    console.log("   Timelock validation:", debugTime);

    console.log("\n✅ All read function tests completed.");

    await api.disconnect();
    console.log("👋 Disconnected from Polkadot node");
}

testReadFunctions().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});