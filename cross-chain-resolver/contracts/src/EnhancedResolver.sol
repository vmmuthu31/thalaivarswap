// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import {IOrderMixin} from "limit-order-protocol/contracts/interfaces/IOrderMixin.sol";
import {TakerTraits} from "limit-order-protocol/contracts/libraries/TakerTraitsLib.sol";

import {IResolverExample} from "../lib/cross-chain-swap/contracts/interfaces/IResolverExample.sol";
import {RevertReasonForwarder} from "../lib/cross-chain-swap/lib/solidity-utils/contracts/libraries/RevertReasonForwarder.sol";
import {IEscrowFactory} from "../lib/cross-chain-swap/contracts/interfaces/IEscrowFactory.sol";
import {IBaseEscrow} from "../lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol";
import {TimelocksLib, Timelocks} from "../lib/cross-chain-swap/contracts/libraries/TimelocksLib.sol";
import {Address} from "solidity-utils/contracts/libraries/AddressLib.sol";
import {IEscrow} from "../lib/cross-chain-swap/contracts/interfaces/IEscrow.sol";
import {ImmutablesLib} from "../lib/cross-chain-swap/contracts/libraries/ImmutablesLib.sol";

/**
 * @title Enhanced Resolver for ETH↔DOT Cross-Chain Swaps
 * @dev Integrates with 1inch Fusion+ protocol for cross-chain atomic swaps
 * Supports both EVM and non-EVM chains (specifically Polkadot)
 * 
 * @custom:security-contact security@1inch.io
 */
contract EnhancedResolver is Ownable, ReentrancyGuard {
    using ImmutablesLib for IBaseEscrow.Immutables;
    using TimelocksLib for Timelocks;
    using SafeERC20 for IERC20;

    // Events
    event CrossChainOrderCreated(
        bytes32 indexed orderHash,
        address indexed maker,
        uint256 srcChainId,
        uint256 dstChainId,
        address srcToken,
        bytes dstToken,
        uint256 amount,
        bytes32 secretHash
    );

    event SecretRevealed(
        bytes32 indexed orderHash,
        bytes32 indexed secret,
        address indexed revealer
    );

    event CrossChainSwapCompleted(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 srcAmount,
        uint256 dstAmount
    );

    event RelayerRegistered(
        address indexed relayer,
        uint256[] supportedChains
    );

    // Errors
    error InvalidLength();
    error LengthMismatch();
    error InvalidChainId();
    error InvalidSecret();
    error OrderNotFound();
    error OrderAlreadyFilled();
    error UnauthorizedRelayer();
    error InsufficientBalance();
    error TransferFailed();
    error InvalidTimelock();
    error SecretAlreadyRevealed();

    // Structs
    struct CrossChainOrder {
        address maker;
        address taker;
        uint256 srcChainId;
        uint256 dstChainId;
        address srcToken;
        bytes dstToken; // For non-EVM chains, this can be encoded differently
        uint256 srcAmount;
        uint256 dstAmount;
        bytes32 secretHash;
        bytes32 secret;
        uint256 timelock;
        bool filled;
        bool cancelled;
        uint256 createdAt;
        bytes makerData; // Additional data for cross-chain coordination
        bytes takerData;
    }

    struct RelayerInfo {
        bool registered;
        uint256[] supportedChains;
        uint256 stake;
        uint256 reputation;
        bool active;
    }

    // State variables
    IEscrowFactory private immutable _FACTORY;
    IOrderMixin private immutable _LOP;
    
    mapping(bytes32 => CrossChainOrder) public orders;
    mapping(address => RelayerInfo) public relayers;
    mapping(uint256 => bool) public supportedChains;
    mapping(bytes32 => bytes32) public secretRegistry; // orderHash => secret
    
    uint256 public constant POLKADOT_CHAIN_ID = 1000; // Custom chain ID for Polkadot
    uint256 public constant MIN_TIMELOCK = 3600; // 1 hour
    uint256 public constant MAX_TIMELOCK = 86400 * 7; // 7 days
    uint256 public constant RELAYER_STAKE_REQUIRED = 1 ether;
    
    uint256 public orderNonce;
    uint256 public protocolFee = 30; // 0.3% in basis points

    constructor(
        IEscrowFactory factory,
        IOrderMixin lop,
        address initialOwner
    ) Ownable(initialOwner) {
        _FACTORY = factory;
        _LOP = lop;
        
        // Initialize supported chains
        supportedChains[1] = true; // Ethereum Mainnet
        supportedChains[11155111] = true; // Sepolia Testnet
        supportedChains[POLKADOT_CHAIN_ID] = true; // Polkadot
    }

    receive() external payable {}

    /**
     * @notice Register as a relayer for cross-chain operations
     * @param supportedChainIds Array of chain IDs the relayer supports
     */
    function registerRelayer(uint256[] calldata supportedChainIds) external payable {
        if (msg.value < RELAYER_STAKE_REQUIRED) {
            revert InsufficientBalance();
        }

        RelayerInfo storage relayer = relayers[msg.sender];
        relayer.registered = true;
        relayer.supportedChains = supportedChainIds;
        relayer.stake += msg.value;
        relayer.active = true;

        emit RelayerRegistered(msg.sender, supportedChainIds);
    }

    /**
     * @notice Create a cross-chain order for ETH → DOT swap
     * @param dstToken Encoded destination token (for Polkadot, this would be DOT)
     * @param dstAmount Amount of destination tokens expected
     * @param secretHash Hash of the secret for HTLC
     * @param timelock Expiration time for the order
     * @param makerData Additional data for cross-chain coordination
     */
    function createEthToDotOrder(
        bytes calldata dstToken,
        uint256 dstAmount,
        bytes32 secretHash,
        uint256 timelock,
        bytes calldata makerData
    ) external payable nonReentrant returns (bytes32 orderHash) {
        if (msg.value == 0) revert InsufficientBalance();
        if (timelock < block.timestamp + MIN_TIMELOCK || timelock > block.timestamp + MAX_TIMELOCK) {
            revert InvalidTimelock();
        }

        orderHash = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                POLKADOT_CHAIN_ID,
                address(0), // ETH
                dstToken,
                msg.value,
                dstAmount,
                secretHash,
                timelock,
                orderNonce++
            )
        );

        orders[orderHash] = CrossChainOrder({
            maker: msg.sender,
            taker: address(0),
            srcChainId: block.chainid,
            dstChainId: POLKADOT_CHAIN_ID,
            srcToken: address(0), // ETH
            dstToken: dstToken,
            srcAmount: msg.value,
            dstAmount: dstAmount,
            secretHash: secretHash,
            secret: bytes32(0),
            timelock: timelock,
            filled: false,
            cancelled: false,
            createdAt: block.timestamp,
            makerData: makerData,
            takerData: ""
        });

        emit CrossChainOrderCreated(
            orderHash,
            msg.sender,
            block.chainid,
            POLKADOT_CHAIN_ID,
            address(0),
            dstToken,
            msg.value,
            secretHash
        );

        return orderHash;
    }

    /**
     * @notice Create a cross-chain order for DOT → ETH swap
     * @param srcToken Encoded source token from Polkadot
     * @param srcAmount Amount of source tokens
     * @param ethAmount Amount of ETH expected
     * @param secretHash Hash of the secret for HTLC
     * @param timelock Expiration time for the order
     * @param makerData Additional data for cross-chain coordination
     */
    function createDotToEthOrder(
        bytes calldata srcToken,
        uint256 srcAmount,
        uint256 ethAmount,
        bytes32 secretHash,
        uint256 timelock,
        bytes calldata makerData
    ) external nonReentrant returns (bytes32 orderHash) {
        if (timelock < block.timestamp + MIN_TIMELOCK || timelock > block.timestamp + MAX_TIMELOCK) {
            revert InvalidTimelock();
        }

        orderHash = keccak256(
            abi.encodePacked(
                msg.sender,
                POLKADOT_CHAIN_ID,
                block.chainid,
                srcToken,
                address(0), // ETH
                srcAmount,
                ethAmount,
                secretHash,
                timelock,
                orderNonce++
            )
        );

        orders[orderHash] = CrossChainOrder({
            maker: msg.sender,
            taker: address(0),
            srcChainId: POLKADOT_CHAIN_ID,
            dstChainId: block.chainid,
            srcToken: address(0), // Placeholder for DOT
            dstToken: abi.encodePacked(address(0)), // ETH
            srcAmount: srcAmount,
            dstAmount: ethAmount,
            secretHash: secretHash,
            secret: bytes32(0),
            timelock: timelock,
            filled: false,
            cancelled: false,
            createdAt: block.timestamp,
            makerData: makerData,
            takerData: ""
        });

        emit CrossChainOrderCreated(
            orderHash,
            msg.sender,
            POLKADOT_CHAIN_ID,
            block.chainid,
            address(0),
            abi.encodePacked(address(0)),
            srcAmount,
            secretHash
        );

        return orderHash;
    }

    /**
     * @notice Fill a cross-chain order (called by relayers)
     * @param orderHash Hash of the order to fill
     * @param secret Secret to unlock the HTLC
     * @param takerData Additional data from the taker
     */
    function fillOrder(
        bytes32 orderHash,
        bytes32 secret,
        bytes calldata takerData
    ) external payable nonReentrant {
        CrossChainOrder storage order = orders[orderHash];
        
        if (order.maker == address(0)) revert OrderNotFound();
        if (order.filled || order.cancelled) revert OrderAlreadyFilled();
        if (block.timestamp > order.timelock) revert InvalidTimelock();
        
        // Verify secret
        if (keccak256(abi.encodePacked(secret)) != order.secretHash) {
            revert InvalidSecret();
        }

        // Verify relayer is authorized and supports the required chains
        RelayerInfo storage relayer = relayers[msg.sender];
        if (!relayer.registered || !relayer.active) {
            revert UnauthorizedRelayer();
        }
        
        // Check if relayer supports both source and destination chains
        bool supportsSrc = false;
        bool supportsDst = false;
        for (uint256 i = 0; i < relayer.supportedChains.length; i++) {
            if (relayer.supportedChains[i] == order.srcChainId) {
                supportsSrc = true;
            }
            if (relayer.supportedChains[i] == order.dstChainId) {
                supportsDst = true;
            }
        }
        if (!supportsSrc || !supportsDst) {
            revert UnauthorizedRelayer();
        }

        // Mark order as filled and store secret
        order.filled = true;
        order.taker = msg.sender;
        order.secret = secret;
        order.takerData = takerData;
        
        // Store secret in registry for public access
        secretRegistry[orderHash] = secret;

        // Execute the swap based on direction with fee handling
        if (order.srcChainId == block.chainid) {
            // ETH → DOT: Transfer ETH to relayer (minus protocol fee)
            uint256 protocolFeeAmount = _calculateProtocolFee(order.srcAmount);
            uint256 relayerAmount = order.srcAmount - protocolFeeAmount;
            
            _executeEthTransfer(msg.sender, relayerAmount);
            // Protocol fee stays in contract
        } else {
            // DOT → ETH: Relayer must provide ETH, transfer to maker (minus protocol fee)
            if (msg.value < order.dstAmount) revert InsufficientBalance();
            
            uint256 protocolFeeAmount = _calculateProtocolFee(order.dstAmount);
            uint256 makerAmount = order.dstAmount - protocolFeeAmount;
            
            _executeEthTransfer(order.maker, makerAmount);
            
            // Refund excess ETH to relayer if any
            if (msg.value > order.dstAmount) {
                _executeEthTransfer(msg.sender, msg.value - order.dstAmount);
            }
        }

        emit SecretRevealed(orderHash, secret, msg.sender);
        emit CrossChainSwapCompleted(
            orderHash,
            order.maker,
            msg.sender,
            order.srcAmount,
            order.dstAmount
        );
    }

    /**
     * @notice Reveal secret for an order (public function)
     * @param orderHash Hash of the order
     * @param secret Secret to reveal
     */
    function revealSecret(bytes32 orderHash, bytes32 secret) external {
        CrossChainOrder storage order = orders[orderHash];
        
        if (order.maker == address(0)) revert OrderNotFound();
        if (order.secret != bytes32(0)) revert SecretAlreadyRevealed();
        
        // Verify secret
        if (keccak256(abi.encodePacked(secret)) != order.secretHash) {
            revert InvalidSecret();
        }

        order.secret = secret;
        secretRegistry[orderHash] = secret;

        emit SecretRevealed(orderHash, secret, msg.sender);
    }

    /**
     * @notice Cancel an order (only maker can cancel)
     * @param orderHash Hash of the order to cancel
     */
    function cancelOrder(bytes32 orderHash) external nonReentrant {
        CrossChainOrder storage order = orders[orderHash];
        
        if (order.maker != msg.sender) revert UnauthorizedRelayer();
        if (order.filled) revert OrderAlreadyFilled();
        if (block.timestamp <= order.timelock) revert InvalidTimelock();

        order.cancelled = true;

        // Refund ETH if this was an ETH → DOT order
        if (order.srcChainId == block.chainid && order.srcToken == address(0)) {
            _executeEthTransfer(order.maker, order.srcAmount);
        }
    }

    /**
     * @notice Get order details
     * @param orderHash Hash of the order
     */
    function getOrder(bytes32 orderHash) external view returns (CrossChainOrder memory) {
        return orders[orderHash];
    }

    /**
     * @notice Get revealed secret for an order
     * @param orderHash Hash of the order
     */
    function getSecret(bytes32 orderHash) external view returns (bytes32) {
        return secretRegistry[orderHash];
    }

    /**
     * @notice Check if an order exists
     * @param orderHash Hash of the order
     */
    function orderExists(bytes32 orderHash) external view returns (bool) {
        return orders[orderHash].maker != address(0);
    }

    /**
     * @notice Legacy 1inch Fusion+ integration functions
     */
    function deploySrc(
        IBaseEscrow.Immutables calldata immutables,
        IOrderMixin.Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits,
        bytes calldata args
    ) external payable onlyOwner {
        IBaseEscrow.Immutables memory immutablesMem = immutables;
        immutablesMem.timelocks = TimelocksLib.setDeployedAt(immutables.timelocks, block.timestamp);
        address computed = _FACTORY.addressOfEscrowSrc(immutablesMem);

        (bool success,) = address(computed).call{value: immutablesMem.safetyDeposit}("");
        if (!success) revert IBaseEscrow.NativeTokenSendingFailure();

        takerTraits = TakerTraits.wrap(TakerTraits.unwrap(takerTraits) | uint256(1 << 251));
        bytes memory argsMem = abi.encodePacked(computed, args);
        _LOP.fillOrderArgs(order, r, vs, amount, takerTraits, argsMem);
    }

    function deployDst(
        IBaseEscrow.Immutables calldata dstImmutables,
        uint256 srcCancellationTimestamp
    ) external onlyOwner payable {
        _FACTORY.createDstEscrow{value: msg.value}(dstImmutables, srcCancellationTimestamp);
    }

    function withdraw(
        IEscrow escrow,
        bytes32 secret,
        IBaseEscrow.Immutables calldata immutables
    ) external {
        escrow.withdraw(secret, immutables);
    }

    function cancel(
        IEscrow escrow,
        IBaseEscrow.Immutables calldata immutables
    ) external {
        escrow.cancel(immutables);
    }

    function arbitraryCalls(
        address[] calldata targets,
        bytes[] calldata arguments
    ) external onlyOwner {
        uint256 length = targets.length;
        if (targets.length != arguments.length) revert LengthMismatch();
        for (uint256 i = 0; i < length; ++i) {
            (bool success,) = targets[i].call(arguments[i]);
            if (!success) RevertReasonForwarder.reRevert();
        }
    }

    /**
     * @notice Admin functions
     */
    function addSupportedChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = true;
    }

    function removeSupportedChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = false;
    }

    function updateProtocolFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "Fee too high"); // Max 10%
        protocolFee = newFee;
    }

    function withdrawProtocolFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            _executeEthTransfer(owner(), balance);
        }
    }

    /**
     * @notice Release ETH from contract to specified address (owner only)
     * @param to Address to send ETH to
     * @param amount Amount of ETH to send (in wei)
     */
    function releaseEth(address to, uint256 amount) external onlyOwner {
        if (address(this).balance < amount) revert InsufficientBalance();
        _executeEthTransfer(to, amount);
    }

    /**
     * @notice Emergency function to release all ETH from contract
     * @param to Address to send all ETH to
     */
    function emergencyWithdrawAll(address to) external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            _executeEthTransfer(to, balance);
        }
    }

    /**
     * @notice Get contract ETH balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Internal helper functions
     */
    function _executeEthTransfer(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function _calculateProtocolFee(uint256 amount) internal view returns (uint256) {
        return (amount * protocolFee) / 10000;
    }
}