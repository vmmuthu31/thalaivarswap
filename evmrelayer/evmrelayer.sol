// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EVMRelayer
 * @dev Ethereum-side HTLC contract for 1inch Fusion+ cross-chain swaps
 */
contract EVMRelayer is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct LockContract {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        bytes32 preimage;
        bytes32 swapId;
        uint32 destinationChain;
    }

    mapping(bytes32 => LockContract) public contracts;
    mapping(address => bool) public authorizedResolvers;
    
    address public fusionRouter;
    uint256 public resolverFee; 
    
    event HTLCNew(
        bytes32 indexed contractId,
        address indexed sender,
        address indexed receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bytes32 swapId
    );
    
    event HTLCWithdraw(
        bytes32 indexed contractId,
        bytes32 indexed secret
    );
    
    event HTLCRefund(bytes32 indexed contractId);
    
    event ResolverAuthorized(address indexed resolver, bool authorized);
    
    event FusionOrderFilled(
        bytes32 indexed swapId,
        address indexed resolver,
        uint256 fee
    );

    modifier onlyAuthorizedResolver() {
        require(authorizedResolvers[msg.sender], "Unauthorized resolver");
        _;
    }

    modifier contractExists(bytes32 _contractId) {
        require(haveContract(_contractId), "Contract does not exist");
        _;
    }

    modifier futureTimelock(uint256 _time) {
        require(_time > block.timestamp, "Timelock must be in future");
        _;
    }

    modifier withdrawable(bytes32 _contractId) {
        LockContract storage c = contracts[_contractId];
        require(c.receiver == msg.sender, "Not authorized to withdraw");
        require(!c.withdrawn, "Already withdrawn");
        require(!c.refunded, "Already refunded");
        require(c.timelock > block.timestamp, "Timelock expired");
        _;
    }

    modifier refundable(bytes32 _contractId) {
        LockContract storage c = contracts[_contractId];
        require(c.sender == msg.sender, "Not authorized to refund");
        require(!c.withdrawn, "Already withdrawn");
        require(!c.refunded, "Already refunded");
        require(c.timelock <= block.timestamp, "Timelock not expired");
        _;
    }

    constructor(address _fusionRouter, uint256 _resolverFee, address _initialOwner) Ownable(_initialOwner) {
        fusionRouter = _fusionRouter;
        resolverFee = _resolverFee;
    }

    /**
     * @dev Create a new HTLC for ERC20 tokens
     */
    function newERC20Contract(
        address _receiver,
        address _token,
        uint256 _amount,
        bytes32 _hashlock,
        uint256 _timelock,
        bytes32 _swapId,
        uint32 _destinationChain
    ) external futureTimelock(_timelock) returns (bytes32 contractId) {
        require(_amount > 0, "Amount must be greater than 0");
        require(_token != address(0), "Invalid token address");
        
        contractId = keccak256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                _token,
                _amount,
                _hashlock,
                _timelock,
                _swapId,
                block.timestamp
            )
        );
        
        require(!haveContract(contractId), "Contract already exists");
        
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        
        contracts[contractId] = LockContract({
            sender: msg.sender,
            receiver: _receiver,
            token: _token,
            amount: _amount,
            hashlock: _hashlock,
            timelock: _timelock,
            withdrawn: false,
            refunded: false,
            preimage: 0x0,
            swapId: _swapId,
            destinationChain: _destinationChain
        });
        
        emit HTLCNew(
            contractId,
            msg.sender,
            _receiver,
            _token,
            _amount,
            _hashlock,
            _timelock,
            _swapId
        );
    }

    /**
     * @dev Create a new HTLC for ETH
     */
    function newETHContract(
        address _receiver,
        bytes32 _hashlock,
        uint256 _timelock,
        bytes32 _swapId,
        uint32 _destinationChain
    ) external payable futureTimelock(_timelock) returns (bytes32 contractId) {
        require(msg.value > 0, "Must send ETH");
        
        contractId = keccak256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                address(0), 
                msg.value,
                _hashlock,
                _timelock,
                _swapId,
                block.timestamp
            )
        );
        
        require(!haveContract(contractId), "Contract already exists");
        
        contracts[contractId] = LockContract({
            sender: msg.sender,
            receiver: _receiver,
            token: address(0),
            amount: msg.value,
            hashlock: _hashlock,
            timelock: _timelock,
            withdrawn: false,
            refunded: false,
            preimage: 0x0,
            swapId: _swapId,
            destinationChain: _destinationChain
        });
        
        emit HTLCNew(
            contractId,
            msg.sender,
            _receiver,
            address(0),
            msg.value,
            _hashlock,
            _timelock,
            _swapId
        );
    }

    /**
     * @dev Withdraw funds by revealing the preimage
     */
    function withdraw(
        bytes32 _contractId,
        bytes32 _preimage
    ) 
        external 
        contractExists(_contractId) 
        withdrawable(_contractId) 
        nonReentrant 
    {
        LockContract storage c = contracts[_contractId];
        
        require(
            sha256(abi.encodePacked(_preimage)) == c.hashlock,
            "Hashlock mismatch"
        );
        
        c.preimage = _preimage;
        c.withdrawn = true;
        
        if (c.token == address(0)) {
            (bool success, ) = c.receiver.call{value: c.amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(c.token).safeTransfer(c.receiver, c.amount);
        }
        
        emit HTLCWithdraw(_contractId, _preimage);
    }

    /**
     * @dev Refund tokens after timelock expiry
     */
    function refund(bytes32 _contractId) 
        external 
        contractExists(_contractId) 
        refundable(_contractId) 
        nonReentrant 
    {
        LockContract storage c = contracts[_contractId];
        c.refunded = true;
        
        if (c.token == address(0)) {
            (bool success, ) = c.sender.call{value: c.amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(c.token).safeTransfer(c.sender, c.amount);
        }
        
        emit HTLCRefund(_contractId);
    }

    /**
     * @dev Fusion+ resolver function - withdraw on behalf of receiver
     */
    function resolverWithdraw(
        bytes32 _contractId,
        bytes32 _preimage,
        address _feeRecipient
    ) 
        external 
        onlyAuthorizedResolver
        contractExists(_contractId) 
        nonReentrant 
    {
        LockContract storage c = contracts[_contractId];
        
        require(!c.withdrawn && !c.refunded, "Already processed");
        require(c.timelock > block.timestamp, "Timelock expired");
        require(
            sha256(abi.encodePacked(_preimage)) == c.hashlock,
            "Hashlock mismatch"
        );
        
        c.preimage = _preimage;
        c.withdrawn = true;
        
        uint256 fee = (c.amount * resolverFee) / 10000;
        uint256 receiverAmount = c.amount - fee;
        
        if (c.token == address(0)) {
            (bool success1, ) = c.receiver.call{value: receiverAmount}("");
            require(success1, "ETH transfer to receiver failed");
            
            if (fee > 0) {
                (bool success2, ) = _feeRecipient.call{value: fee}("");
                require(success2, "ETH transfer to resolver failed");
            }
        } else {
            IERC20(c.token).safeTransfer(c.receiver, receiverAmount);
            if (fee > 0) {
                IERC20(c.token).safeTransfer(_feeRecipient, fee);
            }
        }
        
        emit HTLCWithdraw(_contractId, _preimage);
        emit FusionOrderFilled(c.swapId, msg.sender, fee);
    }

    /**
     * @dev Get contract details
     */
    function getContract(bytes32 _contractId)
        external
        view
        returns (
            address sender,
            address receiver,
            address token,
            uint256 amount,
            bytes32 hashlock,
            uint256 timelock,
            bool withdrawn,
            bool refunded,
            bytes32 preimage,
            bytes32 swapId
        )
    {
        if (!haveContract(_contractId)) {
            return (address(0), address(0), address(0), 0, 0, 0, false, false, 0, 0);
        }
        
        LockContract storage c = contracts[_contractId];
        return (
            c.sender,
            c.receiver,
            c.token,
            c.amount,
            c.hashlock,
            c.timelock,
            c.withdrawn,
            c.refunded,
            c.preimage,
            c.swapId
        );
    }

    /**
     * @dev Check if contract exists
     */
    function haveContract(bytes32 _contractId) internal view returns (bool exists) {
        exists = (contracts[_contractId].sender != address(0));
    }

    /**
     * @dev Get revealed secret
     */
    function getSecret(bytes32 _contractId) external view returns (bytes32) {
        return contracts[_contractId].preimage;
    }

    /**
     * @dev Admin function to authorize resolvers
     */
    function authorizeResolver(address _resolver, bool _authorized) external onlyOwner {
        authorizedResolvers[_resolver] = _authorized;
        emit ResolverAuthorized(_resolver, _authorized);
    }

    /**
     * @dev Admin function to update resolver fee
     */
    function setResolverFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high");
        resolverFee = _fee;
    }

    /**
     * @dev Emergency function to withdraw stuck tokens
     */
    function emergencyWithdraw(
        address _token,
        uint256 _amount,
        address _to
    ) external onlyOwner {
        if (_token == address(0)) {
            (bool success, ) = _to.call{value: _amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
    }
}
