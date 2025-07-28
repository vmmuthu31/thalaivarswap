import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-20">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            ThalaivarSwap
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Secure bidirectional cross-chain swaps between Ethereum and Polkadot
            using 1inch Fusion+ protocol and Hash Time Locked Contracts (HTLCs).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-3xl mb-4">🔄</div>
              <h3 className="text-xl font-semibold mb-2">
                Bidirectional Swaps
              </h3>
              <p className="text-gray-600">
                Complete ETH → DOT and DOT → ETH swap functionality with
                identical security for both directions.
              </p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-3xl mb-4">🔒</div>
              <h3 className="text-xl font-semibold mb-2">HTLC Security</h3>
              <p className="text-gray-600">
                Dual escrows on both chains with linked secrets and matched swap
                parameters for atomic swaps.
              </p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-3xl mb-4">⚡</div>
              <h3 className="text-xl font-semibold mb-2">1inch Fusion+</h3>
              <p className="text-gray-600">
                Leverages 1inch&apos;s advanced cross-chain protocol for optimal
                pricing and execution.
              </p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-3xl mb-4">📊</div>
              <h3 className="text-xl font-semibold mb-2">
                Real-time Monitoring
              </h3>
              <p className="text-gray-600">
                Event-driven architecture with comprehensive swap tracking and
                status updates.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Link
              href="/swap"
              className="inline-block px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all transform hover:scale-105 shadow-lg"
            >
              Launch Swap Interface
            </Link>

            <div className="text-sm text-gray-500">
              <p>🚨 Testnet Demo - Use Sepolia ETH and Paseo DOT only</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            How It Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-blue-600 font-bold">1</span>
              </div>
              <h3 className="font-semibold mb-2">Create Order</h3>
              <p className="text-sm text-gray-600">
                Generate Fusion+ order with secret hash for both chains
              </p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-purple-600 font-bold">2</span>
              </div>
              <h3 className="font-semibold mb-2">Create Escrows</h3>
              <p className="text-sm text-gray-600">
                Deploy HTLC contracts on both Ethereum and Polkadot
              </p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-green-600 font-bold">3</span>
              </div>
              <h3 className="font-semibold mb-2">Wait Finality</h3>
              <p className="text-sm text-gray-600">
                Ensure block finality on both chains before proceeding
              </p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-yellow-600 font-bold">4</span>
              </div>
              <h3 className="font-semibold mb-2">Complete Swap</h3>
              <p className="text-sm text-gray-600">
                Reveal secret to unlock funds on both chains atomically
              </p>
            </div>
          </div>
        </div>

        <div className="text-center text-gray-500 text-sm">
          <p>Built with ❤️ for the cross-chain future</p>
          <p className="mt-2">
            <a
              href="https://github.com/your-org/thalaivarswap"
              className="hover:text-blue-600 transition-colors"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
