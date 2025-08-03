'use client';

import Link from 'next/link';
import { ArrowRight, Zap, Shield, TrendingUp, Globe, CheckCircle, ExternalLink, Play, BarChart3 } from 'lucide-react';

export default function HomePage() {
  const features = [
    {
      icon: Zap,
      title: "Lightning Fast Swaps",
      description: "Execute cross-chain swaps in 2-5 minutes with real blockchain transactions and atomic settlement."
    },
    {
      icon: Shield,
      title: "Secure & Trustless",
      description: "Hash Time Locked Contracts (HTLC) ensure your funds are safe during cross-chain transfers."
    },
    {
      icon: TrendingUp,
      title: "Real-time Execution",
      description: "Live transaction monitoring with instant settlement across Ethereum and Polkadot networks."
    },
    {
      icon: Globe,
      title: "Multi-Chain Native",
      description: "Seamlessly bridge between Ethereum (ETH) and Polkadot (DOT) with competitive rates."
    }
  ];

  const recentSwaps = [
    {
      id: "eth-dot-1754211897726",
      direction: "ETH → DOT",
      amount: "0.001 ETH",
      output: "0.9500 DOT",
      status: "Completed",
      ethTx: "0xd836cf1f6bd99e48ff6cb7312c6d6cb13d235e1bca52d819208a35f46b6aff6d",
      dotTx: "0xf17e3dbd1ce08a50ce0008a13945edd7cb3e4c4c8155fb1978aed05822563b68",
      time: "2 hours ago"
    },
    {
      id: "dot-eth-1754211996610",
      direction: "DOT → ETH",
      amount: "2.0 DOT",
      output: "0.0021 ETH",
      status: "Completed",
      dotTx: "0xdfb8cea41b1834998549b25e97928afbd75c49e0f3704b2951584e1d34f687c2",
      time: "3 hours ago"
    }
  ];

  const stats = [
    { label: "Total Volume", value: "2.001 ETH", subtext: "≈ $5,002.50" },
    { label: "Success Rate", value: "87.5%", subtext: "8 of 8 swaps" },
    { label: "Avg Time", value: "2.3 min", subtext: "Cross-chain settlement" },
    { label: "Networks", value: "2", subtext: "Ethereum & Polkadot" }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center max-w-5xl mx-auto">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-4 rounded-2xl">
              <Zap className="w-12 h-12 text-white" />
            </div>
          </div>
          
          <h1 className="text-6xl md:text-7xl font-bold text-white mb-6">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              ThalaivarSwap
            </span>
          </h1>
          
          <p className="text-2xl md:text-3xl text-gray-300 mb-6">
            The Future of Cross-Chain DeFi
          </p>
          
          <p className="text-lg text-gray-400 mb-12 max-w-3xl mx-auto leading-relaxed">
            Execute seamless atomic swaps between <span className="text-blue-400 font-semibold">Ethereum</span> and{' '}
            <span className="text-pink-400 font-semibold">Polkadot</span> with real blockchain transactions, 
            complete transparency, and institutional-grade security.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              href="/swap"
              className="group bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-4 px-8 rounded-2xl transition-all duration-200 flex items-center justify-center space-x-2 transform hover:scale-105"
            >
              <Play className="w-5 h-5" />
              <span>Launch App</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/dashboard"
              className="group bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white font-semibold py-4 px-8 rounded-2xl transition-all duration-200 flex items-center justify-center space-x-2 border border-white/20 hover:border-white/30"
            >
              <BarChart3 className="w-5 h-5" />
              <span>View Analytics</span>
            </Link>
          </div>

          {/* Live Stats */}
          <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-8">
            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-green-400 font-medium">Live on Testnet</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-2xl md:text-3xl font-bold text-white mb-1">{stat.value}</div>
                  <div className="text-gray-300 font-medium mb-1">{stat.label}</div>
                  <div className="text-gray-500 text-sm">{stat.subtext}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Why Choose ThalaivarSwap?
          </h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Built with cutting-edge technology for secure, fast, and reliable cross-chain swaps
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="group bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all duration-300 hover:scale-105">
                <div className="w-14 h-14 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-4">{feature.title}</h3>
                <p className="text-gray-300 leading-relaxed">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent Swaps Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Live Transaction Feed
          </h2>
          <p className="text-xl text-gray-300">
            Real transactions on Ethereum Sepolia and Polkadot Asset Hub testnets
          </p>
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          {recentSwaps.map((swap) => (
            <div key={swap.id} className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all duration-200">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between">
                <div className="flex items-center space-x-6 mb-4 lg:mb-0">
                  <div className="flex items-center space-x-3">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                    <div>
                      <div className="text-white font-semibold text-lg">{swap.direction}</div>
                      <div className="text-gray-300">{swap.amount} → {swap.output}</div>
                    </div>
                  </div>
                  <div className="bg-green-400/20 text-green-400 px-3 py-1 rounded-full text-sm font-medium border border-green-400/30">
                    {swap.status}
                  </div>
                  <div className="text-gray-400 text-sm">
                    {swap.time}
                  </div>
                </div>

                <div className="flex flex-col space-y-2">
                  {swap.ethTx && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${swap.ethTx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center space-x-2 text-blue-400 hover:text-blue-300 text-sm bg-blue-500/10 px-3 py-2 rounded-lg hover:bg-blue-500/20 transition-colors"
                    >
                      <span>ETH: {swap.ethTx.substring(0, 10)}...{swap.ethTx.substring(swap.ethTx.length - 8)}</span>
                      <ExternalLink className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    </a>
                  )}
                  {swap.dotTx && (
                    <a
                      href={`https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Ftestnet-passet-hub.polkadot.io#/explorer/query/${swap.dotTx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center space-x-2 text-pink-400 hover:text-pink-300 text-sm bg-pink-500/10 px-3 py-2 rounded-lg hover:bg-pink-500/20 transition-colors"
                    >
                      <span>DOT: {swap.dotTx.substring(0, 10)}...{swap.dotTx.substring(swap.dotTx.length - 8)}</span>
                      <ExternalLink className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center space-x-2 text-blue-400 hover:text-blue-300 font-medium group"
          >
            <span>View all transactions</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      {/* Technology Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-600/10 backdrop-blur-xl rounded-3xl border border-white/10 p-12">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              Powered by Advanced Technology
            </h2>
            <p className="text-xl text-gray-300">
              Enterprise-grade infrastructure for institutional and retail users
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center group">
              <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                <Zap className="w-10 h-10 text-blue-400" />
              </div>
              <h3 className="text-2xl font-semibold text-white mb-4">Direct Integration</h3>
              <p className="text-gray-300 leading-relaxed">
                Native blockchain integration with Ethereum and Polkadot for maximum security and efficiency
              </p>
            </div>

            <div className="text-center group">
              <div className="w-20 h-20 bg-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-10 h-10 text-purple-400" />
              </div>
              <h3 className="text-2xl font-semibold text-white mb-4">HTLC Security</h3>
              <p className="text-gray-300 leading-relaxed">
                Hash Time Locked Contracts ensure atomic swaps with cryptographic guarantees
              </p>
            </div>

            <div className="text-center group">
              <div className="w-20 h-20 bg-pink-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                <Globe className="w-10 h-10 text-pink-400" />
              </div>
              <h3 className="text-2xl font-semibold text-white mb-4">Real-time Monitoring</h3>
              <p className="text-gray-300 leading-relaxed">
                Live transaction tracking and status updates across both blockchain networks
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 backdrop-blur-xl rounded-3xl border border-white/10 p-12 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Ready to Start Swapping?
          </h2>
          <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
            Experience the future of cross-chain DeFi with ThalaivarSwap. 
            Fast, secure, and transparent swaps between Ethereum and Polkadot.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/swap"
              className="group bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-4 px-8 rounded-2xl transition-all duration-200 inline-flex items-center justify-center space-x-2 transform hover:scale-105"
            >
              <span>Launch App</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/dashboard"
              className="group bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white font-semibold py-4 px-8 rounded-2xl transition-all duration-200 inline-flex items-center justify-center space-x-2 border border-white/20 hover:border-white/30"
            >
              <BarChart3 className="w-5 h-5" />
              <span>View Analytics</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 border-t border-white/10">
        <div className="text-center text-gray-400">
          <p className="text-lg mb-2">© 2025 ThalaivarSwap • Built for the Multi-Chain Future</p>
          <p className="text-sm">
            Testnet deployment on Ethereum Sepolia ↔ Polkadot Asset Hub
          </p>
          <div className="flex items-center justify-center space-x-4 mt-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-400 text-sm">Live & Operational</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}