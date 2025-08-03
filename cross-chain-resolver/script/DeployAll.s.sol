// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// Import required contracts
import "../contracts/src/EnhancedResolver.sol";
import "cross-chain-swap/EscrowFactory.sol";
import "limit-order-protocol/contracts/LimitOrderProtocol.sol";
import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// Mock ERC20 for testing (fee and access tokens)
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18);
    }
}

contract DeployAll is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("ETH_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying with account:", deployer);
        console.log("Account balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy mock tokens for EscrowFactory
        console.log("Deploying mock tokens...");
        MockToken feeToken = new MockToken("Fee Token", "FEE");
        MockToken accessToken = new MockToken("Access Token", "ACCESS");
        
        console.log("Fee Token deployed at:", address(feeToken));
        console.log("Access Token deployed at:", address(accessToken));

        // Step 2: Deploy LimitOrderProtocol
        console.log("Deploying LimitOrderProtocol...");
        LimitOrderProtocol limitOrderProtocol = new LimitOrderProtocol();
        console.log("LimitOrderProtocol deployed at:", address(limitOrderProtocol));

        // Step 3: Deploy EscrowFactory
        console.log("Deploying EscrowFactory...");
        EscrowFactory escrowFactory = new EscrowFactory(
            address(limitOrderProtocol),  // limitOrderProtocol
            IERC20(address(feeToken)),    // feeToken
            IERC20(address(accessToken)), // accessToken
            deployer,                     // owner
            3600,                         // rescueDelaySrc (1 hour)
            3600                          // rescueDelayDst (1 hour)
        );
        console.log("EscrowFactory deployed at:", address(escrowFactory));

        // Step 4: Deploy EnhancedResolver
        console.log("Deploying EnhancedResolver...");
        EnhancedResolver enhancedResolver = new EnhancedResolver(
            IEscrowFactory(address(escrowFactory)),
            IOrderMixin(address(limitOrderProtocol)),
            deployer
        );
        console.log("EnhancedResolver deployed at:", address(enhancedResolver));

        // Step 5: Setup initial configuration
        console.log("Setting up initial configuration...");
        
        // Add Polkadot as supported chain
        enhancedResolver.addSupportedChain(1000);
        console.log("Added Polkadot (1000) as supported chain");
        
        // Set protocol fee to 0.3%
        enhancedResolver.updateProtocolFee(30);
        console.log("Set protocol fee to 0.3%");

        vm.stopBroadcast();

        // Print deployment summary
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Fee Token:          ", address(feeToken));
        console.log("Access Token:       ", address(accessToken));
        console.log("LimitOrderProtocol: ", address(limitOrderProtocol));
        console.log("EscrowFactory:      ", address(escrowFactory));
        console.log("EnhancedResolver:   ", address(enhancedResolver));
        console.log("\n=== UPDATE YOUR .ENV FILE ===");
        console.log("ETH_ENHANCED_RESOLVER_ADDRESS=", address(enhancedResolver));
        console.log("ESCROW_FACTORY_ADDRESS=", address(escrowFactory));
        console.log("LIMIT_ORDER_PROTOCOL_ADDRESS=", address(limitOrderProtocol));
    }
}