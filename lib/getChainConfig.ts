export const getChainConfig = (chain: string) => {
  const chainMap: Record<
    string,
    { chainId: number; dexName: string; version: string }
  > = {
    BASE_MAINNET: { chainId: 8453, dexName: "uniswap", version: "3" },
    ETH_MAINNET: { chainId: 1, dexName: "uniswap", version: "3" },
    BSC_MAINNET: { chainId: 56, dexName: "pancakeswap", version: "2" },
  };

  return chainMap[chain] || chainMap["ETH_MAINNET"];
};
