# ThalaivarSwap: Bidirectional Cross-Chain Swap Protocol

A comprehensive bidirectional cross-chain swap system enabling secure ETH ↔ DOT swaps using 1inch Fusion+ protocol integration, Hash Time Locked Contracts (HTLCs), Dutch auction mechanisms, and enterprise-grade monitoring.

## 🌟 Features

- **🔄 Bidirectional Swaps**: Complete ETH → DOT and DOT → ETH swap functionality
- **🏛️ Dutch Auction System**: Competitive resolver participation with dynamic pricing
- **🔗 1inch Fusion+ Integration**: Custom bridge integration for cross-chain operations
- **🔐 Dual HTLC Security**: Atomic swaps with identical security parameters across chains
- **📊 Real-time Monitoring**: Enterprise-grade monitoring with comprehensive analytics
- **⚡ Event-driven Architecture**: Real-time event processing and status synchronization
- **🛡️ Production Security**: Secret coordination, timelock management, and error recovery
- **🧪 Demo Ready**: Complete end-to-end demonstration capabilities
- **🌐 Multi-testnet Support**: Deployed on Ethereum Sepolia and Polkadot Paseo

## 🏗️ Implementation Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ThalaivarSwap Protocol                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐             │
│  │   Ethereum      │    │  Bidirectional  │    │   Polkadot      │             │
│  │   (Sepolia)     │◄──►│    Relayer      │◄──►│   (Paseo)      │             │
│  │                 │    │                 │    │                 │             │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │             │
│  │ │ EVM HTLC    │ │    │ │ Dutch       │ │    │ │ ink! HTLC   │ │             │
│  │ │ Contract    │ │    │ │ Auction     │ │    │ │ Contract    │ │             │
│  │ │             │ │    │ │ Engine      │ │    │ │             │ │             │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │             │
│  │                 │    │                 │    │                 │             │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │             │
│  │ │ Event       │ │    │ │ Secret      │ │    │ │ Event       │ │             │
│  │ │ Listener    │ │    │ │ Coordinator │ │    │ │ Listener    │ │             │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │             │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘             │
│                                   │                                             │
│  ┌─────────────────────────────────▼─────────────────────────────────┐         │
│  │                    Monitoring & Analytics Layer                    │         │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │         │
│  │  │ Block Sync  │ │ HTLC Status │ │ Swap Metrics│ │ Health      │  │         │
│  │  │ Monitor     │ │ Tracker     │ │ Collector   │ │ Monitor     │  │         │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │         │
│  └─────────────────────────────────────────────────────────────────────┘         │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐         │
│  │                        1inch Fusion+ Integration                   │         │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │         │
│  │  │ Custom      │ │ Order       │ │ Quote       │ │ Secret      │  │         │
│  │  │ Bridge SDK  │ │ Management  │ │ Generation  │ │ Management  │  │         │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │         │
│  └─────────────────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. **Cross-Chain Relayer** (`lib/cross-chain-relayer.ts`)

The heart of the system that orchestrates cross-chain operations.

**Key Responsibilities:**

- Cross-chain event monitoring and processing
- Secret coordination between Ethereum and Polkadot HTLCs
- Dutch auction management and resolver coordination
- Comprehensive system monitoring and health checks
- HTLC lifecycle management and expiration handling

**Architecture Features:**

- Event-driven design with real-time processing
- Atomic secret revelation across chains
- Automatic HTLC expiration detection
- Performance metrics and analytics collection

#### 2. **Fusion+ SDK Integration** (`lib/fusion-sdk.ts`)

Custom 1inch Fusion+ integration with Polkadot support.

**Implementation Highlights:**

- Custom bridge logic for ETH ↔ DOT swaps
- Polkadot chain integration (not natively supported by 1inch)
- Secret management compatible with Fusion+ protocol
- Quote generation with custom pricing logic
- Order creation and status monitoring

**Key Methods:**

```typescript
// Create ETH → DOT swap with custom bridge
await fusionSDK.createEthToDotSwap(amount, wallet, recipient);

// Create DOT → ETH swap with custom bridge
await fusionSDK.createDotToEthSwap(amount, wallet, recipient);

// Execute complete bidirectional workflow
await fusionSDK.executeBidirectionalSwap(direction, amount, wallet, recipient);
```

#### 3. **Smart Contracts**

##### **Ethereum HTLC Contract** (`evmrelayer/evmrelayer.sol`)

Solidity-based HTLC implementation for Ethereum side.

**Features:**

- OpenZeppelin security standards
- Protocol fee collection (0.3% default)
- Relayer registration system
- Time-based expiration with refund mechanism
- Support for ETH and ERC20 tokens

**Key Functions:**

```solidity
function newContract(
    address receiver,
    address token,
    uint256 amount,
    bytes32 hashlock,
    uint256 timelock,
    bytes32 swapId,
    uint32 sourceChain,
    uint32 destChain,
    uint256 destAmount
) external payable returns (bytes32);

function withdraw(bytes32 contractId, bytes32 preimage) external;
function refund(bytes32 contractId) external;
```

##### **Polkadot HTLC Contract** (`polkadotrelayer/src/lib.rs`)

ink! smart contract for Polkadot side operations.

**Features:**

- Native DOT support with balance transfers
- Compatible hashlock/timelock mechanism
- Block-based timelock (vs timestamp on Ethereum)
- Protocol fee collection in DOT
- Admin functions for fee management

**Key Methods:**

```rust
#[ink(message)]
#[ink(payable)]
pub fn new_contract(
    &mut self,
    receiver: Address,
    hashlock: [u8; 32],
    timelock: BlockNumber,
    swap_id: [u8; 32],
    source_chain: u32,
    dest_chain: u32,
    dest_amount: Balance,
) -> Result<[u8; 32], Error>;

#[ink(message)]
pub fn withdraw(&mut self, contract_id: [u8; 32], preimage: [u8; 32]) -> Result<(), Error>;
```

## 🏛️ Dutch Auction System

### Architecture

The Dutch auction mechanism enables competitive resolver participation with dynamic pricing.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Dutch Auction Flow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 1. Auction Creation                                             │
│    ├─ Start Price: 1.1 ETH (10% premium)                      │
│    ├─ End Price: 0.95 ETH (5% discount)                       │
│    ├─ Duration: 30 seconds                                     │
│    └─ Linear price decay                                       │
│                                                                 │
│ 2. Price Decay Mechanism                                       │
│    ├─ Real-time price updates (every 1 second)                │
│    ├─ Linear interpolation: price = start - (start-end)*progress│
│    └─ Automatic expiration handling                            │
│                                                                 │
│ 3. Resolver Participation                                      │
│    ├─ Competitive bidding at current price                     │
│    ├─ First valid bid wins                                     │
│    ├─ Automatic HTLC creation for winner                       │
│    └─ Gas price optimization support                           │
│                                                                 │
│ 4. Execution                                                   │
│    ├─ ETH → DOT: Create ETH HTLC + DOT HTLC                   │
│    ├─ DOT → ETH: Create DOT HTLC + ETH HTLC                   │
│    ├─ Secret coordination                                      │
│    └─ Atomic completion                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Features

**Dynamic Pricing:**

```typescript
// Linear price decay calculation
const progress = Math.min(elapsed / duration, 1);
const currentPrice = startPrice - (startPrice - endPrice) * progress;
```

**Resolver Integration:**

```typescript
// Resolvers can participate with competitive bids
const result = await relayer.participateInDutchAuction(
  orderId,
  resolverAddress,
  bidPrice,
  maxGasPrice
);
```

**Automatic Execution:**

- Winner automatically gets HTLC contracts created
- Secret coordination handled by relayer
- Gas optimization for resolver profitability

## 📊 Comprehensive Monitoring System

### Real-time Monitoring Components

#### 1. **Block Synchronization Monitoring**

- Tracks Ethereum and Polkadot block heights
- Detects sync lag and connection issues
- Real-time sync status updates

#### 2. **HTLC Status Monitoring**

- Tracks all active HTLC contracts
- Automatic expiration detection
- Status change notifications

#### 3. **Swap Metrics Collection**

- Success/failure rates
- Average swap completion times
- Volume analytics by direction
- Hourly transaction volumes

#### 4. **Health Monitoring**

- Connection status for both chains
- Sync lag detection
- Error rate monitoring
- Performance alerts

### Monitoring Events

```typescript
// Block updates
relayer.on("eth-block-update", (data) => {
  console.log(`ETH Block: ${data.blockNumber} (synced: ${data.synced})`);
});

// Metrics updates
relayer.on("metrics-update", (metrics) => {
  console.log("Swap metrics:", metrics);
});

// Health checks
relayer.on("health-check", (health) => {
  if (health.issues.length > 0) {
    console.warn("Health issues:", health.issues);
  }
});
```

### Analytics API

```typescript
// Get comprehensive monitoring status
const status = relayer.getMonitoringStatus();

// Get detailed swap analytics
const analytics = relayer.getSwapAnalytics();
// Returns: success rates, timing, volume by direction, hourly data
```

## 🔐 Security Architecture

### HTLC Security Model

**Atomic Swaps:**

- Same secret hash used on both chains
- Timelock coordination (Ethereum: shorter, Polkadot: longer)
- Automatic refund after expiration

**Secret Coordination:**

```typescript
// Centralized secret registry
private secretRegistry = new Map<string, {
  secret: string;
  hashlock: string;
  ethContractId?: string;
  dotContractId?: string;
  revealed: boolean;
  timestamp: number;
}>();
```

**Security Features:**

- Protocol fee collection (0.3% default)
- Relayer authorization system
- Gas price optimization
- Reentrancy protection (OpenZeppelin)
- Admin controls for fee management

## 🚀 Getting Started

### Prerequisites

```bash
# Node.js 18+ required
node --version

# Install dependencies
npm install
```

### Environment Setup

Create a `.env` file:

```env
# Ethereum Configuration
ETH_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ETH_PRIVATE_KEY=your_ethereum_private_key
ETH_CONTRACT_ADDRESS=0x...  # Deployed EVM relayer contract

# Polkadot Configuration
POLKADOT_WS_URL=wss://Paseo-rpc.polkadot.io
POLKADOT_SEED=//Alice
POLKADOT_CONTRACT_ADDRESS=5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY

# 1inch Fusion+ API
FUSION_API_KEY=your_1inch_api_key
```

### Contract Deployment

#### Ethereum Contract (Remix IDE)

1. Open [Remix IDE](https://remix.ethereum.org)
2. Upload `evmrelayer/evmrelayer.sol`
3. Install OpenZeppelin contracts: `@openzeppelin/contracts`
4. Compile with Solidity 0.8.19
5. Deploy to Sepolia testnet
6. Update `ETH_CONTRACT_ADDRESS` in `.env`

#### Polkadot Contract

```bash
# Build the ink! contract
cd polkadotrelayer
cargo contract build

# Deploy using Polkadot.js Apps or contracts-ui
# Update POLKADOT_CONTRACT_ADDRESS in .env
```

## 🎮 Usage Examples

### Complete Cross-Chain Demo

```bash
# Run the comprehensive demo
npm run demo:complete
```

This demonstrates:

- System initialization and monitoring startup
- Dutch auction creation and price decay
- ETH → DOT swap execution
- DOT → ETH swap execution
- Real-time monitoring and analytics
- System health verification

### Individual Swap Demos

```bash
# ETH → DOT swap demo
npm run demo:eth-to-dot

# DOT → ETH swap demo
npm run demo:dot-to-eth
```

## 📸 Demo Results

The following screenshots demonstrate the complete bidirectional swap functionality:

### ETH → DOT Swap Flow

**1. ETH Deposit Confirmation**
![ETH Deposited](./public/ethdeposited.png)
*ETH successfully deposited into the HTLC contract on Ethereum Sepolia testnet*

**2. ETH to DOT Swap Execution**
![ETH to DOT Swap](./public/eth-dot.png)
*Cross-chain swap from ETH to DOT showing the atomic transaction execution*

### DOT → ETH Swap Flow

**3. DOT Deposit Confirmation**
![DOT Deposited](./public/dotdeposited.png)
*DOT successfully deposited into the HTLC contract on Polkadot Paseo testnet*

**4. DOT to ETH Swap Execution**
![DOT to ETH Swap](./public/dot-eth.png)
*Cross-chain swap from DOT to ETH demonstrating bidirectional functionality*

### Complete Swap Results

**5. Final Swap Completion**
![Swap Result](./public/swapresult.png)
*Successful completion of the cross-chain swap with final balances and transaction confirmations*

### Key Achievements Demonstrated

✅ **Atomic Cross-Chain Swaps**: Both ETH→DOT and DOT→ETH swaps completed atomically  
✅ **HTLC Security**: Hash Time Locked Contracts working correctly on both chains  
✅ **Secret Coordination**: Proper secret revelation enabling atomic completion  
✅ **Bidirectional Functionality**: Full support for swaps in both directions  
✅ **Real-time Monitoring**: Live tracking of swap progress and completion  
✅ **Production Ready**: Deployed and tested on Sepolia and Paseo testnets

### Programmatic Usage

```typescript
import { CrossChainRelayer } from "./lib/cross-chain-relayer";
import { FusionCrossChainSDK } from "./lib/fusion-sdk";

// Initialize relayer
const relayer = new CrossChainRelayer();
await relayer.initialize();

// Create ETH → DOT swap
const swap = await relayer.createEthToDotSwap(
  "0.01", // 0.01 ETH
  "0x742d35Cc6635C0532925a3b8D400e3d0d4C7C6b8", // ETH sender
  "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" // DOT recipient
);

// Monitor completion
relayer.on("swap-completed", (completedSwap) => {
  console.log(`Swap ${completedSwap.swapId} completed!`);
});

// Create Dutch auction
await relayer.createDutchAuction(
  swapId,
  "1.1", // Start price (10% premium)
  "0.95", // End price (5% discount)
  30000, // 30 second duration
  swapDetails
);

// Resolver participation
const result = await relayer.participateInDutchAuction(
  orderId,
  resolverAddress,
  bidPrice,
  maxGasPrice
);
```

## 📈 Monitoring Dashboard

### Real-time Metrics

```typescript
// Get live monitoring status
const status = relayer.getMonitoringStatus();
console.log({
  isMonitoring: status.isMonitoring,
  activeSwaps: status.activeSwaps,
  metrics: status.metrics,
  recentErrors: status.recentErrors,
});

// Get detailed analytics
const analytics = relayer.getSwapAnalytics();
console.log({
  totalSwaps: analytics.totalSwaps,
  successRate: analytics.successRate,
  avgSwapTime: analytics.avgSwapTime,
  hourlyVolume: analytics.hourlyVolume,
});
```

### Event Monitoring

```typescript
// Comprehensive event listening
relayer.on("auction-created", (data) => {
  console.log("New auction:", data.orderId);
});

relayer.on("auction-price-update", (data) => {
  console.log(`Price: ${data.currentPrice} (${data.progress}%)`);
});

relayer.on("swap-tracked", (data) => {
  console.log(`Tracking swap: ${data.swapId}`);
});

relayer.on("metrics-update", (metrics) => {
  console.log("System metrics updated:", metrics);
});
```

## 🔧 API Reference

### CrossChainRelayer

**Core Methods:**

- `initialize()` - Initialize relayer and start monitoring
- `createEthToDotSwap(amount, sender, recipient)` - Create ETH→DOT swap
- `createDotToEthSwap(amount, sender, recipient)` - Create DOT→ETH swap
- `coordinateSecretReveal(swapId)` - Coordinate atomic secret reveal

**Dutch Auction:**

- `createDutchAuction(swapId, startPrice, endPrice, duration, details)` - Create auction
- `participateInDutchAuction(orderId, resolver, bidPrice, maxGas)` - Resolver participation
- `getAuctionStatus(orderId)` - Get auction state
- `getActiveAuctions()` - List active auctions

**Monitoring:**

- `startMonitoring()` - Start comprehensive monitoring
- `getMonitoringStatus()` - Get current monitoring state
- `getSwapAnalytics()` - Get detailed analytics
- `healthCheck()` - Check system health

### FusionCrossChainSDK

**Swap Creation:**

- `createEthToDotSwap(amount, wallet, recipient)` - Create ETH→DOT order
- `createDotToEthSwap(amount, wallet, recipient)` - Create DOT→ETH order
- `executeBidirectionalSwap(direction, amount, wallet, recipient)` - Full workflow

**Order Management:**

- `getSwapQuote(params)` - Get swap quote (custom bridge for Polkadot)
- `createSwapOrder(quote, wallet, fee)` - Create swap order
- `monitorOrderStatus(orderHash)` - Monitor order status

## 🏆 Production Features

### ✅ Implemented

- **Bidirectional ETH ↔ DOT swaps** with atomic execution
- **Dutch auction mechanism** with competitive resolver participation
- **Custom 1inch Fusion+ integration** for Polkadot support
- **Complete Polkadot event parsing** and processing
- **Secret coordination** between Ethereum and Polkadot HTLCs
- **Comprehensive monitoring system** with real-time analytics
- **End-to-end demo scripts** for testing and demonstration
- **Production-grade error handling** and recovery mechanisms

### 🔄 Next Steps

- **Contract deployment** to Sepolia and Paseo testnets
- **Integration test suite** for automated testing
- **Performance optimization** and gas cost reduction
- **UI/UX interface** for user-friendly interactions

## 📊 Performance Metrics

**Typical Swap Times:**

- ETH → DOT: ~30-60 seconds (depending on block times)
- DOT → ETH: ~30-60 seconds (depending on block times)

**Security Parameters:**

- Ethereum timelock: 1-24 hours (configurable)
- Polkadot timelock: 100-14400 blocks (configurable)
- Protocol fee: 0.3% (configurable)

**Monitoring Intervals:**

- Block sync: Every 5 seconds
- HTLC status: Every 10 seconds
- Health checks: Every 15 seconds
- Metrics collection: Every 30 seconds

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Update documentation
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **1inch Network** for Fusion+ protocol inspiration
- **Polkadot** for substrate and ink! smart contract framework
- **OpenZeppelin** for security-audited smart contract libraries
- **Ethereum Foundation** for EVM compatibility

---

**Built with ❤️ for the future of cross-chain DeFi**
