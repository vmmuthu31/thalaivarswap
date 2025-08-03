// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// Import required contracts
import "cross-chain-swap/EscrowFactory.sol";
import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import "../contracts/src/EnhancedResolver.sol";

// Simple ERC20 token for testing
contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1M tokens
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DeployStep2 is Script {
    function run() external {
        // Use the private key directly
        uint256 deployerPrivateKey = 0x75a1d50b20916114ddbc545000a4ccf57b2624c991838fa6a927caf5aa4e969b;
        address deployer = vm.addr(deployerPrivateKey);
        
        // Get the deployed LimitOrderProtocol address
        address limitOrderProtocol = 0xacDD7709fFdd06afF4704Add6E50504F9630E206;
        
        console.log("=== STEP 2 DEPLOYMENT STARTING ===");
        console.log("Deployer address:", deployer);
        console.log("LimitOrderProtocol:", limitOrderProtocol);
        console.log("Deployer balance:", deployer.balance / 1e18, "ETH");
        
        require(deployer.balance > 0.01 ether, "Insufficient ETH balance");
        
        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy test tokens for EscrowFactory
        console.log("\n1. Deploying test tokens...");
        TestToken feeToken = new TestToken("Fee Token", "FEE");
        TestToken accessToken = new TestToken("Access Token", "ACCESS");
        console.log("   Fee Token deployed at:", address(feeToken));
        console.log("   Access Token deployed at:", address(accessToken));

        // Step 2: Deploy EscrowFactory
        console.log("\n2. Deploying EscrowFactory...");
        EscrowFactory escrowFactory = new EscrowFactory(
            limitOrderProtocol,           // limitOrderProtocol
            IERC20(address(feeToken)),    // feeToken
            IERC20(address(accessToken)), // accessToken
            deployer,                     // owner
            3600,                         // rescueDelaySrc (1 hour)
            3600                          // rescueDelayDst (1 hour)
        );
        console.log("   EscrowFactory deployed at:", address(escrowFactory));

        // Step 3: Deploy EnhancedResolver
        console.log("\n3. Deploying EnhancedResolver...");
        EnhancedResolver enhancedResolver = new EnhancedResolver(
            IEscrowFactory(address(escrowFactory)),
            IOrderMixin(limitOrderProtocol),
            deployer
        );
        console.log("   EnhancedResolver deployed at:", address(enhancedResolver));

        // Step 4: Configure EnhancedResolver
        console.log("\n4. Configuring EnhancedResolver...");
        
        // Add supported chains
        enhancedResolver.addSupportedChain(1);      // Ethereum Mainnet
        enhancedResolver.addSupportedChain(11155111); // Sepolia
        enhancedResolver.addSupportedChain(1000);   // Polkadot
        console.log("   Added supported chains: 1, 11155111, 1000");
        
        // Set protocol fee
        enhancedResolver.updateProtocolFee(30); // 0.3%
        console.log("   Set protocol fee to 0.3%");

        vm.stopBroadcast();

        // Print final summary
        console.log("\n=== DEPLOYMENT COMPLETED SUCCESSFULLY ===");
        console.log("Network: Sepolia Testnet");
        console.log("\nDeployed Contracts:");
        console.log("- LimitOrderProtocol:  ", limitOrderProtocol);
        console.log("- Fee Token:           ", address(feeToken));
        console.log("- Access Token:        ", address(accessToken));
        console.log("- EscrowFactory:       ", address(escrowFactory));
        console.log("- EnhancedResolver:    ", address(enhancedResolver));
        
        console.log("\n=== UPDATE YOUR .ENV FILES ===");
        console.log("Add these lines to your .env files:");
        console.log("");
        console.log("# Enhanced Resolver Configuration");
        console.log("ETH_ENHANCED_RESOLVER_ADDRESS=", address(enhancedResolver));
        console.log("ESCROW_FACTORY_ADDRESS=", address(escrowFactory));
        console.log("FEE_TOKEN_ADDRESS=", address(feeToken));
        console.log("ACCESS_TOKEN_ADDRESS=", address(accessToken));
        
        console.log("\n=== NEXT STEPS ===");
        console.log("1. Update your .env files with the addresses above");
        console.log("2. Test the deployment with: npm run demo:eth-dot-atomic-swap");
        console.log("3. Register as a relayer if needed");
        console.log("4. Deploy Polkadot contracts");
        
        console.log("\nReady for ETH to DOT atomic swaps!");
    }
}