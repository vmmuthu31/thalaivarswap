// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract contract EthereumHTLC is ReentrancyGuard, Ownable {
 is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    constructor(address initialOwner) Ownable(initialOwner) {}

    struct PartialFillOrder {
        address maker;
        address token; // address(0) for ETH
        uint256 totalAmount;
        uint256 filledAmount;
        uint256 minFillAmount;
        bytes32 hashlock;
        uint256 timelock;
        bool cancelled;
        bytes32 swapId;
        uint32 sourceChain;
        uint32 destChain;
        uint256 destAmountPerUnit; // Destination amount per source unit
        uint256 fee;
        bool allowPartialFills;
        uint256 maxFills;
        uint256 currentFills;
    }

    struct FillExecution {
        bytes32 orderId;
        address taker;
        uint256 fillAmount;
        bytes32 contractId;
        bool withdrawn;
        bool refunded;
        bytes32 preimage;
        uint256 timestamp;
    }

    mapping(bytes32 => PartialFillOrder) public orders;
    mapping(bytes32 => FillExecution) public fills;
    mapping(bytes32 => bytes32[]) public orderFills; // orderId => fillIds[]
    mapping(address => bool) public authorizedRelayers;

    uint256 public orderCounter;
    uint256 public fillCounter;
    uint16 public protocolFeeBps = 30; // 0.3%
    uint256 public protocolFees;
    uint256 public minTimelock = 1 hours;
    uint256 public maxTimelock = 24 hours;

    event PartialFillOrderCreated(
        bytes32 indexed orderId,
        address indexed maker,
        address token,
        uint256 totalAmount,
        uint256 minFillAmount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId,
        uint32 sourceChain,
        uint32 destChain,
        uint256 destAmountPerUnit,
        bool allowPartialFills,
        uint256 maxFills
    );

    event OrderFilled(
        bytes32 indexed orderId,
        bytes32 indexed fillId,
        address indexed taker,
        uint256 fillAmount,
        uint256 destAmount,
        bytes32 contractId
    );

    event FillWithdrawn(
        bytes32 indexed fillId,
        bytes32 indexed secret,
        address indexed taker
    );

    event FillRefunded(
        bytes32 indexed fillId,
        address indexed maker
    );

    event OrderCancelled(bytes32 indexed orderId);

    error OrderAlreadyExists();
    error OrderNotFound();
    error FillNotFound();
    error InvalidTimelock();
    error InsufficientFunds();
    error UnauthorizedFill();
    error UnauthorizedWithdraw();
    error UnauthorizedRefund();
    error InvalidHashlock();
    error AlreadyProcessed();
    error TimelockNotExpired();
    error TimelockExpired();
    error TransferFailed();
    error InvalidChainId();
    error InvalidFillAmount();
    error OrderCancelled();
    error OrderCompleted();
    error PartialFillsNotAllowed();
    error MaxFillsReached();
    error FillAmountTooSmall();
    error InvalidFee();

    modifier validTimelock(uint256 timelock) {
        if (timelock <= block.timestamp) revert InvalidTimelock();
        if (timelock < block.timestamp + minTimelock) revert InvalidTimelock();
        if (timelock > block.timestamp + maxTimelock) revert InvalidTimelock();
        _;
    }

    /// @notice Create new partial fill order
    function createPartialFillOrder(
        address token,
        uint256 totalAmount,
        uint256 minFillAmount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId,
        uint32 sourceChain,
        uint32 destChain,
        uint256 destAmountPerUnit,
        bool allowPartialFills,
        uint256 maxFills
    ) external payable validTimelock(timelock) nonReentrant returns (bytes32) {
        if (sourceChain == destChain) revert InvalidChainId();
        if (minFillAmount == 0 || minFillAmount > totalAmount) revert InvalidFillAmount();
        if (maxFills == 0) revert InvalidFillAmount();

        uint256 actualAmount;
        if (token == address(0)) {
            // ETH transfer
            actualAmount = msg.value;
            if (actualAmount < totalAmount) revert InsufficientFunds();
        } else {
            // ERC20 transfer
            actualAmount = totalAmount;
            IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
        }

        // Calculate protocol fee
        uint256 fee = (actualAmount * protocolFeeBps) / 10000;
        uint256 netAmount = actualAmount - fee;

        bytes32 orderId = generateOrderId(
            msg.sender,
            token,
            netAmount,
            hashlock,
            timelock,
            swapId
        );

        if (orders[orderId].maker != address(0)) {
            revert OrderAlreadyExists();
        }

        orders[orderId] = PartialFillOrder({
            maker: msg.sender,
            token: token,
            totalAmount: netAmount,
            filledAmount: 0,
            minFillAmount: minFillAmount,
            hashlock: hashlock,
            timelock: timelock,
            cancelled: false,
            swapId: swapId,
            sourceChain: sourceChain,
            destChain: destChain,
            destAmountPerUnit: destAmountPerUnit,
            fee: fee,
            allowPartialFills: allowPartialFills,
            maxFills: maxFills,
            currentFills: 0
        });

        protocolFees += fee;

        emit PartialFillOrderCreated(
            orderId,
            msg.sender,
            token,
            netAmount,
            minFillAmount,
            hashlock,
            timelock,
            swapId,
            sourceChain,
            destChain,
            destAmountPerUnit,
            allowPartialFills,
            maxFills
        );

        return orderId;
    }

    /// @notice Fill order (partial or full)
    function fillOrder(
        bytes32 orderId,
        uint256 fillAmount,
        address receiver
    ) external nonReentrant returns (bytes32) {
        PartialFillOrder storage order = orders[orderId];
        
        if (order.maker == address(0)) revert OrderNotFound();
        if (order.cancelled) revert OrderCancelled();
        if (block.timestamp >= order.timelock) revert TimelockExpired();
        if (order.filledAmount >= order.totalAmount) revert OrderCompleted();
        if (order.currentFills >= order.maxFills) revert MaxFillsReached();

        uint256 remainingAmount = order.totalAmount - order.filledAmount;
        if (fillAmount > remainingAmount) {
            fillAmount = remainingAmount;
        }

        if (fillAmount < order.minFillAmount && remainingAmount > order.minFillAmount) {
            revert FillAmountTooSmall();
        }

        if (!order.allowPartialFills && fillAmount < remainingAmount) {
            revert PartialFillsNotAllowed();
        }

        // Create fill execution
        bytes32 fillId = generateFillId(orderId, msg.sender, fillAmount);
        
        if (fills[fillId].taker != address(0)) {
            revert OrderAlreadyExists();
        }

        bytes32 contractId = keccak256(abi.encodePacked(
            orderId,
            fillId,
            block.timestamp,
            fillCounter++
        ));

        fills[fillId] = FillExecution({
            orderId: orderId,
            taker: msg.sender,
            fillAmount: fillAmount,
            contractId: contractId,
            withdrawn: false,
            refunded: false,
            preimage: bytes32(0),
            timestamp: block.timestamp
        });

        // Update order state
        order.filledAmount += fillAmount;
        order.currentFills += 1;

        // Add to order fills tracking
        orderFills[orderId].push(fillId);

        uint256 destAmount = (fillAmount * order.destAmountPerUnit) / 1e18;

        emit OrderFilled(
            orderId,
            fillId,
            msg.sender,
            fillAmount,
            destAmount,
            contractId
        );

        return fillId;
    }

    /// @notice Withdraw filled amount using preimage
    function withdrawFill(bytes32 fillId, bytes32 preimage) external nonReentrant {
        FillExecution storage fill = fills[fillId];
        PartialFillOrder storage order = orders[fill.orderId];

        if (fill.taker == address(0)) revert FillNotFound();
        if (msg.sender != fill.taker) revert UnauthorizedWithdraw();
        if (fill.withdrawn || fill.refunded) revert AlreadyProcessed();
        if (block.timestamp >= order.timelock) revert TimelockExpired();
        if (sha256(abi.encodePacked(preimage)) != order.hashlock) {
            revert InvalidHashlock();
        }

        fill.withdrawn = true;
        fill.preimage = preimage;

        // Transfer funds to taker
        if (order.token == address(0)) {
            // ETH transfer
            (bool success, ) = fill.taker.call{value: fill.fillAmount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 transfer
            IERC20(order.token).safeTransfer(fill.taker, fill.fillAmount);
        }

        emit FillWithdrawn(fillId, preimage, fill.taker);
    }

    /// @notice Refund fill after timelock expires
    function refundFill(bytes32 fillId) external nonReentrant {
        FillExecution storage fill = fills[fillId];
        PartialFillOrder storage order = orders[fill.orderId];

        if (fill.taker == address(0)) revert FillNotFound();
        if (msg.sender != order.maker) revert UnauthorizedRefund();
        if (fill.withdrawn || fill.refunded) revert AlreadyProcessed();
        if (block.timestamp < order.timelock) revert TimelockNotExpired();

        fill.refunded = true;

        // Update order filled amount (subtract refunded amount)
        order.filledAmount -= fill.fillAmount;
        order.currentFills -= 1;

        // Transfer funds back to maker
        if (order.token == address(0)) {
            // ETH transfer
            (bool success, ) = order.maker.call{value: fill.fillAmount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 transfer
            IERC20(order.token).safeTransfer(order.maker, fill.fillAmount);
        }

        emit FillRefunded(fillId, order.maker);
    }

    /// @notice Cancel order and refund remaining amount
    function cancelOrder(bytes32 orderId) external nonReentrant {
        PartialFillOrder storage order = orders[orderId];

        if (order.maker == address(0)) revert OrderNotFound();
        if (msg.sender != order.maker) revert UnauthorizedRefund();
        if (order.cancelled) revert OrderCancelled();

        order.cancelled = true;

        uint256 remainingAmount = order.totalAmount - order.filledAmount;
        if (remainingAmount > 0) {
            // Refund remaining amount to maker
            if (order.token == address(0)) {
                // ETH transfer
                (bool success, ) = order.maker.call{value: remainingAmount}("");
                if (!success) revert TransferFailed();
            } else {
                // ERC20 transfer
                IERC20(order.token).safeTransfer(order.maker, remainingAmount);
            }
        }

        emit OrderCancelled(orderId);
    }

    /// @notice Get order details
    function getOrder(bytes32 orderId) external view returns (PartialFillOrder memory) {
        return orders[orderId];
    }

    /// @notice Get fill details
    function getFill(bytes32 fillId) external view returns (FillExecution memory) {
        return fills[fillId];
    }

    /// @notice Get all fills for an order
    function getOrderFills(bytes32 orderId) external view returns (bytes32[] memory) {
        return orderFills[orderId];
    }

    /// @notice Check if order exists
    function orderExists(bytes32 orderId) external view returns (bool) {
        return orders[orderId].maker != address(0);
    }

    /// @notice Get remaining fillable amount
    function getRemainingAmount(bytes32 orderId) external view returns (uint256) {
        PartialFillOrder storage order = orders[orderId];
        if (order.cancelled || order.filledAmount >= order.totalAmount) {
            return 0;
        }
        return order.totalAmount - order.filledAmount;
    }

    /// @notice Check if order is completely filled
    function isOrderComplete(bytes32 orderId) external view returns (bool) {
        PartialFillOrder storage order = orders[orderId];
        return order.filledAmount >= order.totalAmount;
    }

    /// @notice Get revealed secret for a fill
    function getFillSecret(bytes32 fillId) external view returns (bytes32) {
        return fills[fillId].preimage;
    }

    /// @notice Admin functions
    function updateProtocolFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > 1000) revert InvalidFee(); // Max 10%
        protocolFeeBps = newFeeBps;
    }

    function withdrawProtocolFees() external onlyOwner {
        uint256 fees = protocolFees;
        if (fees == 0) revert InsufficientFunds();

        protocolFees = 0;
        (bool success, ) = owner().call{value: fees}("");
        if (!success) {
            protocolFees = fees; // Restore on failure
            revert TransferFailed();
        }
    }

    function updateTimelockLimits(uint256 minTime, uint256 maxTime) external onlyOwner {
        minTimelock = minTime;
        maxTimelock = maxTime;
    }

    /// @notice Internal function to generate order ID
    function generateOrderId(
        address maker,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId
    ) internal returns (bytes32) {
        orderCounter++;
        return keccak256(abi.encodePacked(
            maker,
            token,
            amount,
            hashlock,
            timelock,
            swapId,
            orderCounter,
            block.chainid
        ));
    }

    /// @notice Internal function to generate fill ID
    function generateFillId(
        bytes32 orderId,
        address taker,
        uint256 fillAmount
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            orderId,
            taker,
            fillAmount,
            block.timestamp,
            block.number
        ));
    }

    /// @notice View functions
    function getProtocolFeeBps() external view returns (uint16) {
        return protocolFeeBps;
    }

    function getProtocolFees() external view returns (uint256) {
        return protocolFees;
    }

    function getOrderCounter() external view returns (uint256) {
        return orderCounter;
    }

    function getFillCounter() external view returns (uint256) {
        return fillCounter;
    }
}