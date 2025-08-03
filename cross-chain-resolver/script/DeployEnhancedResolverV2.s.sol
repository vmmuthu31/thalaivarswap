// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../contracts/src/EnhancedResolver.sol";

contract DeployEnhancedResolverV2 is Script {
    function run() external {
        string memory privateKeyStr = vm.envString("ETH_PRIVATE_KEY");
        uint256 deployerPrivateKey;
        
        // Handle private key with or without 0x prefix
        if (bytes(privateKeyStr).length == 64) {
            // No 0x prefix, add it
            deployerPrivateKey = vm.parseUint(string(abi.encodePacked("0x", privateKeyStr)));
        } else {
            // Has 0x prefix or other format
            deployerPrivateKey = vm.parseUint(privateKeyStr);
        }
        
        address deployer = vm.addr(deployerPrivateKey);
        
        // Get addresses from environment
        address escrowFactoryAddress = vm.envOr("ESCROW_FACTORY_ADDRESS", address(0));
        address limitOrderProtocolAddress = vm.envOr("LIMIT_ORDER_PROTOCOL_ADDRESS", address(0));
        address oldContractAddress = vm.envOr("ETH_ENHANCED_RESOLVER_ADDRESS", address(0));
        
        require(escrowFactoryAddress != address(0), "ESCROW_FACTORY_ADDRESS not set");
        require(limitOrderProtocolAddress != address(0), "LIMIT_ORDER_PROTOCOL_ADDRESS not set");
        
        console.log("Deploying EnhancedResolver V2 with:");
        console.log("Deployer:", deployer);
        console.log("EscrowFactory:", escrowFactoryAddress);
        console.log("LimitOrderProtocol:", limitOrderProtocolAddress);
        console.log("Old Contract:", oldContractAddress);
        
        // Check old contract balance if it exists
        if (oldContractAddress != address(0)) {
            uint256 oldBalance = oldContractAddress.balance;
            console.log("Old contract balance:", oldBalance, "wei");
            console.log("Old contract balance:", oldBalance / 1e18, "ETH");
        }
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy new EnhancedResolver with updated functions
        EnhancedResolver enhancedResolver = new EnhancedResolver(
            IEscrowFactory(escrowFactoryAddress),
            IOrderMixin(limitOrderProtocolAddress),
            deployer
        );
        
        console.log("EnhancedResolver V2 deployed at:", address(enhancedResolver));
        
        // Setup initial configuration
        enhancedResolver.addSupportedChain(1000); // Polkadot
        enhancedResolver.updateProtocolFee(30);   // 0.3%
        
        console.log("Initial configuration completed");

        vm.stopBroadcast();
        
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("New EnhancedResolver V2:", address(enhancedResolver));
        console.log("Owner:", deployer);
        console.log("Gas used for deployment: Check transaction receipt");
        
        console.log("\n=== UPDATE YOUR .ENV FILES ===");
        console.log("ETH_ENHANCED_RESOLVER_ADDRESS=", address(enhancedResolver));
        
        console.log("\n=== NEXT STEPS ===");
        console.log("1. Update .env files with new contract address");
        console.log("2. Run transfer script to move ETH from old contract");
        console.log("3. Test the new contract functions");
        
        if (oldContractAddress != address(0)) {
            console.log("\n=== ETH TRANSFER COMMAND ===");
            console.log("Run: forge script script/TransferEthToNewContract.s.sol --rpc-url $RPC_URL --broadcast --verify");
        }
    }
}