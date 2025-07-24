# ThalaivarSwap: Bidirectional Cross-Chain Swap Protocol

A comprehensive bidirectional cross-chain swap system enabling secure ETH ↔ DOT swaps using 1inch Fusion+ protocol and Hash Time Locked Contracts (HTLCs).

## 🌟 Features

- **Bidirectional Swaps**: Complete ETH → DOT and DOT → ETH swap functionality
- **1inch Fusion+ Integration**: Leverages 1inch's advanced cross-chain protocol
- **Dual HTLC Security**: Identical security parameters on both chains with linked secrets
- **Real-time Monitoring**: Event-driven architecture with comprehensive swap tracking
- **Testnet Ready**: Deployed on Ethereum Sepolia and Polkadot Rococo
- **Demo Scripts**: Complete end-to-end demonstration capabilities
- **Web Interface**: User-friendly interface for swap initiation and monitoring

## 🏗️ Architecture

### Protocol Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Ethereum      │    │  Bidirectional  │    │   Polkadot      │
│   (Sepolia)     │◄──►│    Relayer      │◄──►│   (Rococo)      │
│                 │    │                 │    │                 │
│ EVM HTLC        │    │ Event Monitor   │    │ ink! HTLC       │
│ Contract        │    │ Secret Manager  │    │ Contract        │
│                 │    │ Fusion+ SDK     │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components

1. **Fusion+ SDK Integration** (`lib/fusion-sdk.ts`)

   - Quote generation and order creation
   - Secret management and revelation
   - Cross-chain order monitoring

2. **Bidirectional Relayer** (`lib/bidirectional-relayer.ts`)

   - Event monitoring on both chains
   - Escrow synchronization
   - Swap lifecycle management

3. **Smart Contracts**

   - **EVM Relayer** (`evmrelayer/evmrelayer.sol`): Ethereum HTLC implementation
   - **Polkadot HTLC** (`polkadotrelayer/src/lib.rs`): ink! contract for DOT escrows

4. **Demo Scripts** (`scripts/`)
   - Contract deployment automation
   - End-to-end swap demonstrations
   - Testnet integration examples

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Rust and Cargo (for Polkadot contracts)
- Ethereum Sepolia testnet ETH
- Polkadot Rococo testnet DOT
- 1inch Fusion+ API key

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/thalaivarswap.git
cd thalaivarswap

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Environment Configuration

Create a `.env` file with the following variables:

```bash
# Ethereum Configuration
ETH_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key
ETH_PRIVATE_KEY=your-ethereum-private-key
ETH_CONTRACT_ADDRESS=deployed-evm-contract-address

# Polkadot Configuration
POLKADOT_WS_URL=wss://rococo-rpc.polkadot.io
POLKADOT_SEED=//Alice
POLKADOT_CONTRACT_ADDRESS=deployed-polkadot-contract-address

# 1inch Fusion+ API
FUSION_API_KEY=your-1inch-api-key

# Relayer Configuration
RELAYER_PRIVATE_KEY=your-relayer-private-key
POLKADOT_SEED=//YourSeed
```

## 📦 Deployment

### 1. Deploy Smart Contracts

Deploy both EVM and Polkadot contracts to testnets:

```bash
# Deploy contracts to Ethereum Sepolia and Polkadot Rococo
npm run deploy:contracts

# or manually:
npx ts-node scripts/deploy-contracts.ts
```

This will:

- Deploy the EVM relayer contract to Ethereum Sepolia
- Deploy the ink! HTLC contract to Polkadot Rococo
- Save deployment addresses to `deployments.json`
- Display environment variables for configuration

### 2. Update Configuration

Update your `.env` file with the deployed contract addresses from the deployment output.

## 🔄 Usage Examples

### ETH → DOT Swap Demo

Execute a complete ETH to DOT cross-chain swap:

```bash
# Run the ETH → DOT demo
npm run demo:eth-to-dot

# or manually:
npx ts-node scripts/demo-eth-to-dot.ts
```

**Demo Flow:**

1. Initialize bidirectional relayer
2. Check balances and validate configuration
3. Create Fusion+ order and generate secrets
4. Create ETH escrow with hashlock
5. Wait for finality and create DOT escrow
6. Submit secret to complete swap
7. Verify both escrows are withdrawn

### DOT → ETH Swap Demo

Execute a complete DOT to ETH cross-chain swap:

```bash
# Run the DOT → ETH demo
npm run demo:dot-to-eth

# or manually:
npx ts-node scripts/demo-dot-to-eth.ts
```

### Programmatic Usage

```typescript
import { BidirectionalRelayer } from "./lib/bidirectional-relayer";
import { FusionCrossChainSDK } from "./lib/fusion-sdk";

// Initialize the relayer
const relayer = new BidirectionalRelayer(
  process.env.ETH_RPC_URL,
  process.env.ETH_CONTRACT_ADDRESS,
  process.env.FUSION_API_KEY
);

await relayer.initialize();
await relayer.startMonitoring();

// Create an ETH → DOT swap
const swap = await relayer.createEthToDotSwap(
  "0.01", // 0.01 ETH
  "0x742d35Cc6635C0532925a3b8D400e3d0d4C7C6b8", // ETH sender
  "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" // DOT recipient
);

// Execute the swap
await relayer.executeBidirectionalSwap(swap);

// Monitor completion
relayer.on("swap-completed", (completedSwap) => {
  console.log(`Swap ${completedSwap.swapId} completed successfully!`);
});
```

## 🔧 API Reference

### FusionCrossChainSDK

Main SDK for interacting with 1inch Fusion+ protocol:

```typescript
class FusionCrossChainSDK {
  // Get cross-chain swap quote
  async getSwapQuote(params: CrossChainSwapParams): Promise<Quote>;

  // Create new swap order with secret management
  async createSwapOrder(
    quote: Quote,
    walletAddress: string
  ): Promise<SwapOrder>;

  // Submit secret to complete swap
  async submitSecret(orderHash: string, secret: string): Promise<void>;

  // Monitor order status
  async monitorOrderStatus(orderHash: string): Promise<OrderStatus>;

  // Execute complete bidirectional swap workflow
  async executeBidirectionalSwap(
    direction: "eth-to-dot" | "dot-to-eth",
    amount: string,
    walletAddress: string,
    recipientAddress: string
  ): Promise<SwapResult>;
}
```

### BidirectionalRelayer

Core relayer system managing cross-chain swaps:

```typescript
class BidirectionalRelayer extends EventEmitter {
  // Initialize relayer system
  async initialize(): Promise<void>;

  // Start monitoring both chains
  async startMonitoring(): Promise<void>;

  // Create ETH → DOT swap
  async createEthToDotSwap(
    ethAmount: string,
    ethSender: string,
    dotRecipient: string
  ): Promise<CrossChainSwap>;

  // Create DOT → ETH swap
  async createDotToEthSwap(
    dotAmount: string,
    dotSender: string,
    ethRecipient: string
  ): Promise<CrossChainSwap>;

  // Execute bidirectional swap
  async executeBidirectionalSwap(swap: CrossChainSwap): Promise<void>;

  // Get swap by ID
  getSwap(swapId: string): CrossChainSwap | undefined;

  // Get all active swaps
  getAllSwaps(): CrossChainSwap[];
}
```

### Events

The relayer emits various events for monitoring:

```typescript
// Swap lifecycle events
relayer.on("swap-created", (swap) => {
  /* ... */
});
relayer.on("escrow-created", (swap, chain) => {
  /* ... */
});
relayer.on("swap-ready", (swap) => {
  /* ... */
});
relayer.on("swap-completed", (swap) => {
  /* ... */
});
relayer.on("swap-failed", (swap, error) => {
  /* ... */
});

// Chain-specific events
relayer.on("ethereum-htlc-created", (event) => {
  /* ... */
});
relayer.on("ethereum-htlc-withdrawn", (event) => {
  /* ... */
});
relayer.on("polkadot-contract-event", (event) => {
  /* ... */
});
```

## 🔒 Security Features

### Identical Security Parameters

Both chains use identical security parameters to ensure atomic swaps:

- **Same Hashlock**: Both escrows use the same secret hash
- **Coordinated Timelocks**: ETH escrow has longer timelock than DOT escrow
- **Linked Secrets**: Single secret unlocks both escrows
- **Finality Periods**: Proper finality waiting before secret revelation

### HTLC Implementation

```solidity
// Ethereum HTLC structure
struct LockContract {
    address sender;
    address receiver;
    address token;
    uint256 amount;
    bytes32 hashlock;
    uint256 timelock;
    bool withdrawn;
    bool refunded;
    bytes32 preimage;
    bytes32 swapId;
    uint32 destinationChain;
}
```

```rust
// Polkadot HTLC structure
pub struct LockContract {
    pub sender: Address,
    pub receiver: Address,
    pub amount: Balance,
    pub hashlock: [u8; 32],
    pub timelock: BlockNumber,
    pub withdrawn: bool,
    pub refunded: bool,
    pub preimage: Option<[u8; 32]>,
    pub swap_id: [u8; 32],
    pub source_chain: u32,
}
```

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:fusion-sdk
npm run test:relayer
npm run test:contracts
```

### Integration Tests

```bash
# Run integration tests (requires testnet setup)
npm run test:integration

# Test specific swap directions
npm run test:eth-to-dot
npm run test:dot-to-eth
```

### Demo Tests

```bash
# Test contract deployment
npm run test:deploy

# Test end-to-end swaps
npm run test:demo
```

## 📊 Monitoring and Analytics

### Swap Status Tracking

```typescript
// Monitor swap progress
const swap = relayer.getSwap(swapId);
console.log(`Status: ${swap.status}`);
console.log(`Created: ${new Date(swap.createdAt)}`);
console.log(`ETH Escrow: ${swap.ethEscrow?.contractId}`);
console.log(`DOT Escrow: ${swap.dotEscrow?.contractId}`);
```

### Performance Metrics

- **Swap Completion Time**: Average time from initiation to completion
- **Success Rate**: Percentage of successful swaps
- **Gas Usage**: ETH gas costs for escrow operations
- **Finality Delays**: Time waiting for block finalization

## 🌐 Testnet Information

### Ethereum Sepolia

- **Network ID**: 11155111
- **RPC URL**: `https://eth-sepolia.g.alchemy.com/v2/your-api-key`
- **Faucet**: https://sepoliafaucet.com/
- **Explorer**: https://sepolia.etherscan.io/

### Polkadot Rococo

- **Network**: Rococo Testnet
- **WSS URL**: `wss://rococo-rpc.polkadot.io`
- **Faucet**: https://faucet.polkadot.io/
- **Explorer**: https://rococo.subscan.io/

## 🔗 Block Explorer Links

After running demos, you can verify transactions on block explorers:

```bash
# Ethereum transactions
https://sepolia.etherscan.io/tx/{transaction-hash}

# Polkadot extrinsics
https://rococo.subscan.io/extrinsic/{extrinsic-hash}
```

## 📚 Additional Resources

### 1inch Fusion+ Documentation

- [Fusion+ Whitepaper](https://docs.1inch.io/docs/fusion-plus/introduction)
- [Cross-Chain SDK](https://docs.1inch.io/docs/fusion-plus/sdk/introduction)
- [API Reference](https://docs.1inch.io/docs/fusion-plus/api/introduction)

### Polkadot Resources

- [ink! Smart Contracts](https://use.ink/)
- [Polkadot.js API](https://polkadot.js.org/docs/)
- [Substrate Documentation](https://docs.substrate.io/)

### Ethereum Resources

- [Ethers.js Documentation](https://docs.ethers.org/)
- [Solidity Documentation](https://docs.soliditylang.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Report bugs and request features via GitHub Issues
- **Discussions**: Join our GitHub Discussions for questions and ideas
- **Discord**: Join our community Discord server

## 🚨 Disclaimer

This is experimental software for demonstration purposes. Use at your own risk. Always test thoroughly on testnets before using with real funds.

---

**Built with ❤️ for the cross-chain future**
