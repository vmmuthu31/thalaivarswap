// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../contracts/src/EnhancedResolver.sol";

contract DeployEnhancedResolver is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("ETH_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Get addresses from environment or use defaults
        address escrowFactoryAddress = vm.envOr("ESCROW_FACTORY_ADDRESS", address(0));
        address limitOrderProtocolAddress = vm.envOr("LIMIT_ORDER_PROTOCOL_ADDRESS", address(0));
        
        require(escrowFactoryAddress != address(0), "ESCROW_FACTORY_ADDRESS not set");
        require(limitOrderProtocolAddress != address(0), "LIMIT_ORDER_PROTOCOL_ADDRESS not set");
        
        console.log("Deploying EnhancedResolver with:");
        console.log("Deployer:", deployer);
        console.log("EscrowFactory:", escrowFactoryAddress);
        console.log("LimitOrderProtocol:", limitOrderProtocolAddress);
        
        vm.startBroadcast(deployerPrivateKey);

        EnhancedResolver enhancedResolver = new EnhancedResolver(
            IEscrowFactory(escrowFactoryAddress),
            IOrderMixin(limitOrderProtocolAddress),
            deployer
        );
        
        console.log("EnhancedResolver deployed at:", address(enhancedResolver));
        
        // Setup initial configuration
        enhancedResolver.addSupportedChain(1000); // Polkadot
        enhancedResolver.updateProtocolFee(30);   // 0.3%
        
        console.log("Initial configuration completed");

        vm.stopBroadcast();
        
        console.log("\n=== UPDATE YOUR .ENV FILE ===");
        console.log("ETH_ENHANCED_RESOLVER_ADDRESS=", address(enhancedResolver));
    }
}
