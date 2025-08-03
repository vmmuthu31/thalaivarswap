// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EthereumHTLC is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    constructor(address initialOwner) Ownable(initialOwner) {
        // Constructor logic if needed
    }

    // Rest of the contract code remains the same
    struct LockContract {
        address sender;
        address receiver;
        address token; // address(0) for ETH
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        bytes32 preimage;
        bytes32 swapId;
        uint32 sourceChain;
        uint32 destChain;
        uint256 destAmount;
        uint256 fee;
        address relayer;
    }

    mapping(bytes32 => LockContract) public contracts;
    mapping(address => bool) public authorizedRelayers;

    uint256 public contractCounter;
    uint16 public protocolFeeBps = 30; // 0.3%
    uint256 public protocolFees;
    uint256 public minTimelock = 1 hours;
    uint256 public maxTimelock = 24 hours;

    event HTLCNew(
        bytes32 indexed contractId,
        address indexed sender,
        address indexed receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId,
        uint32 sourceChain,
        uint32 destChain,
        uint256 destAmount,
        address relayer
    );

    event HTLCWithdraw(
        bytes32 indexed contractId,
        bytes32 indexed secret,
        address indexed relayer
    );

    event HTLCRefund(bytes32 indexed contractId);

    event RelayerRegistered(
        bytes32 indexed contractId,
        address indexed relayer
    );

    error ContractAlreadyExists();
    error ContractNotFound();
    error InvalidTimelock();
    error InsufficientFunds();
    error UnauthorizedWithdraw();
    error UnauthorizedRefund();
    error InvalidHashlock();
    error AlreadyProcessed();
    error TimelockNotExpired();
    error TimelockExpired();
    error TransferFailed();
    error InvalidChainId();
    error RelayerAlreadySet();
    error TimelockTooShort();
    error TimelockTooLong();
    error InvalidFee();

    modifier validTimelock(uint256 timelock) {
        if (timelock <= block.timestamp) revert InvalidTimelock();
        if (timelock < block.timestamp + minTimelock) revert TimelockTooShort();
        if (timelock > block.timestamp + maxTimelock) revert TimelockTooLong();
        _;
    }

    /// @notice Create new HTLC for cross-chain swap
    function newContract(
        address receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId,
        uint32 sourceChain,
        uint32 destChain,
        uint256 destAmount
    ) external payable validTimelock(timelock) nonReentrant returns (bytes32) {
        if (sourceChain == destChain) revert InvalidChainId();

        uint256 totalAmount;
        if (token == address(0)) {
            // ETH transfer
            totalAmount = msg.value;
            if (totalAmount == 0) revert InsufficientFunds();
        } else {
            // ERC20 transfer
            if (amount == 0) revert InsufficientFunds();
            totalAmount = amount;
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Calculate protocol fee
        uint256 fee = (totalAmount * protocolFeeBps) / 10000;
        uint256 netAmount = totalAmount - fee;

        bytes32 contractId = generateContractId(
            msg.sender,
            receiver,
            token,
            netAmount,
            hashlock,
            timelock,
            swapId
        );

        if (contracts[contractId].sender != address(0)) {
            revert ContractAlreadyExists();
        }

        contracts[contractId] = LockContract({
            sender: msg.sender,
            receiver: receiver,
            token: token,
            amount: netAmount,
            hashlock: hashlock,
            timelock: timelock,
            withdrawn: false,
            refunded: false,
            preimage: bytes32(0),
            swapId: swapId,
            sourceChain: sourceChain,
            destChain: destChain,
            destAmount: destAmount,
            fee: fee,
            relayer: address(0)
        });

        protocolFees += fee;

        emit HTLCNew(
            contractId,
            msg.sender,
            receiver,
            token,
            netAmount,
            hashlock,
            timelock,
            swapId,
            sourceChain,
            destChain,
            destAmount,
            address(0)
        );

        return contractId;
    }

    /// @notice Register relayer for specific swap
    function registerRelayer(bytes32 contractId) external {
        LockContract storage lock = contracts[contractId];
        if (lock.sender == address(0)) revert ContractNotFound();
        if (lock.relayer != address(0)) revert RelayerAlreadySet();

        lock.relayer = msg.sender;

        emit RelayerRegistered(contractId, msg.sender);
    }

    /// @notice Withdraw funds using preimage
    function withdraw(bytes32 contractId, bytes32 preimage)
        external
        nonReentrant
    {
        LockContract storage lock = contracts[contractId];

        if (lock.sender == address(0)) revert ContractNotFound();
        if (msg.sender != lock.receiver && msg.sender != lock.relayer) {
            revert UnauthorizedWithdraw();
        }
        if (lock.withdrawn || lock.refunded) revert AlreadyProcessed();
        if (block.timestamp >= lock.timelock) revert TimelockExpired();
        if (sha256(abi.encodePacked(preimage)) != lock.hashlock) {
            revert InvalidHashlock();
        }

        lock.withdrawn = true;
        lock.preimage = preimage;

        // Transfer funds
        if (lock.token == address(0)) {
            // ETH transfer
            (bool success, ) = lock.receiver.call{value: lock.amount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 transfer
            IERC20(lock.token).safeTransfer(lock.receiver, lock.amount);
        }

        emit HTLCWithdraw(contractId, preimage, lock.relayer);
    }

    /// @notice Refund sender after timelock expires
    function refund(bytes32 contractId) external nonReentrant {
        LockContract storage lock = contracts[contractId];

        if (lock.sender == address(0)) revert ContractNotFound();
        if (msg.sender != lock.sender) revert UnauthorizedRefund();
        if (lock.withdrawn || lock.refunded) revert AlreadyProcessed();
        if (block.timestamp < lock.timelock) revert TimelockNotExpired();

        lock.refunded = true;

        // Transfer funds back to sender
        if (lock.token == address(0)) {
            // ETH transfer
            (bool success, ) = lock.sender.call{value: lock.amount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 transfer
            IERC20(lock.token).safeTransfer(lock.sender, lock.amount);
        }

        emit HTLCRefund(contractId);
    }

    /// @notice Get contract details
    function getContract(bytes32 contractId)
        external
        view
        returns (LockContract memory)
    {
        return contracts[contractId];
    }

    /// @notice Check if contract exists
    function contractExists(bytes32 contractId) external view returns (bool) {
        return contracts[contractId].sender != address(0);
    }

    /// @notice Get revealed secret
    function getSecret(bytes32 contractId) external view returns (bytes32) {
        return contracts[contractId].preimage;
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

    function updateTimelockLimits(uint256 minTime, uint256 maxTime)
        external
        onlyOwner
    {
        minTimelock = minTime;
        maxTimelock = maxTime;
    }

    /// @notice Internal function to generate contract ID
    function generateContractId(
        address sender,
        address receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId
    ) internal returns (bytes32) {
        contractCounter++;
        return keccak256(abi.encodePacked(
            sender,
            receiver,
            token,
            amount,
            hashlock,
            timelock,
            swapId,
            contractCounter,
            block.chainid
        ));
    }

    /// @notice View functions
    function getProtocolFeeBps() external view returns (uint16) {
        return protocolFeeBps;
    }

    function getProtocolFees() external view returns (uint256) {
        return protocolFees;
    }
}