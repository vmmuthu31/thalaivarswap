'use client';

import React, { useState, useEffect } from 'react';
import { ExternalLink, RefreshCw, TrendingUp, Activity, CheckCircle, Clock, AlertCircle, BarChart3, Zap } from 'lucide-react';

interface SwapStats {
  totalSwaps: number;
  completedSwaps: number;
  failedSwaps: number;
  pendingSwaps: number;
  successRate: string;
  totalVolume: string;
  recentSwaps: any[];
}

interface SwapTransaction {
  swapId: string;
  direction: string;
  amount: string;
  estimatedOutput: string;
  status: string;
  txHash?: string;
  timestamp: string;
  details: any;
  ethTransaction?: any;
  polkadotTransaction?: any;
}

const StatusBadge = ({ status }: { status: string }) => {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'completed':
        return { color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle };
      case 'pending':
      case 'processing':
        return { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock };
      case 'failed':
      case 'partial':
        return { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: AlertCircle };
      default:
        return { color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: Activity };
    }
  };

  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${config.color}`}>
      <Icon className="w-3 h-3" />
      <span>{status.toUpperCase()}</span>
    </div>
  );
};

const MetricCard = ({ title, value, subtitle, icon: Icon, trend }: any) => (
  <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all duration-200">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-gray-400 text-sm font-medium">{title}</p>
        <p className="text-white text-3xl font-bold mt-1">{value}</p>
        {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-xl ${
        trend === 'up' ? 'bg-green-500/20' :
        trend === 'down' ? 'bg-red-500/20' : 'bg-blue-500/20'
      }`}>
        <Icon className={`w-6 h-6 ${
          trend === 'up' ? 'text-green-400' :
          trend === 'down' ? 'text-red-400' : 'text-blue-400'
        }`} />
      </div>
    </div>
  </div>
);

export default function DashboardPage() {
  const [stats, setStats] = useState<SwapStats | null>(null);
  const [swaps, setSwaps] = useState<SwapTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Update every 15 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      // Fetch stats
      const statsResponse = await fetch('/api/swaps/monitor?action=stats');
      const statsData = await statsResponse.json();
      if (statsData.success) {
        setStats(statsData.data);
      }

      // Fetch all swaps
      const swapsResponse = await fetch('/api/swaps/monitor?action=list');
      const swapsData = await swapsResponse.json();
      if (swapsData.success) {
        setSwaps(swapsData.data);
      }

      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getExplorerUrl = (txHash: string, network: 'ethereum' | 'polkadot') => {
    if (network === 'ethereum') {
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    } else {
      return `https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Ftestnet-passet-hub.polkadot.io#/explorer/query/${txHash}`;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const truncateHash = (hash: string) => {
    return `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-white text-xl">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
              <BarChart3 className="w-10 h-10 text-blue-400" />
              Dashboard
            </h1>
            <p className="text-gray-300">
              Real-time cross-chain swap monitoring and analytics
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-gray-400 text-sm">Last updated</div>
              <div className="text-white text-sm font-medium">
                {lastUpdate.toLocaleTimeString()}
              </div>
            </div>
            <button
              onClick={fetchData}
              className="bg-white/10 hover:bg-white/20 rounded-xl p-3 transition-colors"
            >
              <RefreshCw className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <MetricCard
              title="Total Swaps"
              value={stats.totalSwaps}
              subtitle="All time"
              icon={Activity}
              trend="neutral"
            />
            <MetricCard
              title="Success Rate"
              value={stats.successRate}
              subtitle="Reliability"
              icon={TrendingUp}
              trend="up"
            />
            <MetricCard
              title="Total Volume"
              value={`${stats.totalVolume} ETH`}
              subtitle="Equivalent value"
              icon={Zap}
              trend="up"
            />
            <MetricCard
              title="Active Swaps"
              value={stats.pendingSwaps}
              subtitle="Currently processing"
              icon={Clock}
              trend="neutral"
            />
          </div>
        )}

        {/* Status Overview */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Completed</h3>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <div className="text-3xl font-bold text-green-400 mb-2">
                {stats.completedSwaps}
              </div>
              <div className="text-gray-400 text-sm">
                Successfully executed swaps
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Pending</h3>
                <Clock className="w-5 h-5 text-yellow-400" />
              </div>
              <div className="text-3xl font-bold text-yellow-400 mb-2">
                {stats.pendingSwaps}
              </div>
              <div className="text-gray-400 text-sm">
                Currently processing
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Failed</h3>
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div className="text-3xl font-bold text-red-400 mb-2">
                {stats.failedSwaps}
              </div>
              <div className="text-gray-400 text-sm">
                Failed or reverted swaps
              </div>
            </div>
          </div>
        )}

        {/* Recent Swaps Table */}
        <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">Recent Swaps</h2>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-400 text-sm font-medium">Live</span>
            </div>
          </div>

          {swaps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-gray-400 font-medium py-3 px-2">Swap</th>
                    <th className="text-left text-gray-400 font-medium py-3 px-2">Direction</th>
                    <th className="text-left text-gray-400 font-medium py-3 px-2">Amount</th>
                    <th className="text-left text-gray-400 font-medium py-3 px-2">Status</th>
                    <th className="text-left text-gray-400 font-medium py-3 px-2">Transactions</th>
                    <th className="text-left text-gray-400 font-medium py-3 px-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {swaps.map((swap) => (
                    <tr key={swap.swapId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-4 px-2">
                        <div className="font-mono text-white text-sm">
                          {truncateHash(swap.swapId)}
                        </div>
                      </td>
                      <td className="py-4 px-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-white font-medium">
                            {swap.direction === 'eth-to-dot' ? 'ETH → DOT' : 'DOT → ETH'}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-2">
                        <div className="text-white">
                          <div className="font-medium">
                            {swap.amount} {swap.direction.split('-')[0].toUpperCase()}
                          </div>
                          <div className="text-gray-400 text-sm">
                            → {swap.estimatedOutput} {swap.direction.split('-')[2].toUpperCase()}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-2">
                        <StatusBadge status={swap.status} />
                      </td>
                      <td className="py-4 px-2">
                        <div className="space-y-1">
                          {swap.ethTransaction && (
                            <a
                              href={getExplorerUrl(swap.ethTransaction.hash, 'ethereum')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 text-sm group"
                            >
                              <span>ETH: {truncateHash(swap.ethTransaction.hash)}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                          )}
                          {swap.polkadotTransaction && (
                            <a
                              href={getExplorerUrl(swap.polkadotTransaction.hash, 'polkadot')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center space-x-1 text-pink-400 hover:text-pink-300 text-sm group"
                            >
                              <span>DOT: {truncateHash(swap.polkadotTransaction.hash)}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                          )}
                          {swap.txHash && !swap.ethTransaction && !swap.polkadotTransaction && (
                            <span className="text-gray-400 text-sm">
                              {truncateHash(swap.txHash)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-2">
                        <span className="text-gray-300 text-sm">
                          {formatTimestamp(swap.timestamp)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 text-lg">No swaps found</p>
              <p className="text-gray-500 text-sm">Execute your first swap to see it here</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-400">
          <p>Real-time monitoring of cross-chain swaps • Ethereum ↔ Polkadot</p>
          <p className="text-sm mt-1">Data updates every 15 seconds</p>
        </div>
      </div>
    </div>
  );
}