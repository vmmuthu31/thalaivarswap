// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// Simple deployment script that uses existing deployed contracts
contract DeploySimple is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("ETH_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying with account:", deployer);
        console.log("Account balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);

        // For hackathon/testing, we'll use known Sepolia addresses
        // These are standard 1inch protocol addresses on Sepolia
        
        // Use existing 1inch LimitOrderProtocol on Sepolia
        address limitOrderProtocol = 0x11431a89893025D2a48dCA4EddC396f8C8117187; // 1inch LOP on Sepolia
        
        // Deploy a simple EscrowFactory mock for testing
        SimpleEscrowFactory escrowFactory = new SimpleEscrowFactory();
        console.log("SimpleEscrowFactory deployed at:", address(escrowFactory));

        // Deploy EnhancedResolver
        console.log("Deploying EnhancedResolver...");
        EnhancedResolver enhancedResolver = new EnhancedResolver(
            IEscrowFactory(address(escrowFactory)),
            IOrderMixin(limitOrderProtocol),
            deployer
        );
        console.log("EnhancedResolver deployed at:", address(enhancedResolver));

        // Setup initial configuration
        console.log("Setting up initial configuration...");
        enhancedResolver.addSupportedChain(1000); // Polkadot
        enhancedResolver.updateProtocolFee(30);   // 0.3%
        console.log("Configuration completed");

        vm.stopBroadcast();

        // Print deployment summary
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("LimitOrderProtocol: ", limitOrderProtocol);
        console.log("EscrowFactory:      ", address(escrowFactory));
        console.log("EnhancedResolver:   ", address(enhancedResolver));
        console.log("\n=== UPDATE YOUR .ENV FILE ===");
        console.log("ETH_ENHANCED_RESOLVER_ADDRESS=", address(enhancedResolver));
        console.log("ESCROW_FACTORY_ADDRESS=", address(escrowFactory));
        console.log("LIMIT_ORDER_PROTOCOL_ADDRESS=", limitOrderProtocol);
    }
}

// Simple EscrowFactory for testing
contract SimpleEscrowFactory {
    event EscrowCreated(address indexed escrow, bytes32 indexed orderHash);
    
    function addressOfEscrowSrc(bytes memory) external pure returns (address) {
        return address(0x1234567890123456789012345678901234567890);
    }
    
    function createDstEscrow(bytes memory, uint256) external payable {
        emit EscrowCreated(address(this), keccak256("test"));
    }
}

// Import the EnhancedResolver
import "../contracts/src/EnhancedResolver.sol";