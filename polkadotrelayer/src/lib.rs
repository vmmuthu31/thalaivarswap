#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod polkadotrelayer {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;
    use scale::{Encode, Decode};
    use scale_info::TypeInfo;

    /// Type alias for Address using byte array (compatible with TypeInfo)
    pub type Address = [u8; 32];

    /// Cross-chain address representation
    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub enum CrossChainAddress {
        #[allow(clippy::cast_possible_truncation)]
        Ethereum([u8; 20]),
        #[allow(clippy::cast_possible_truncation)]
        Substrate([u8; 32]),
        #[allow(clippy::cast_possible_truncation)]
        Raw(Vec<u8>),
    }

    #[ink(storage)]
    pub struct FusionHtlc {
        contracts: Mapping<[u8; 32], LockContract>,
        contract_counter: u64,
        admin: Address,
        /// Use Address as key for address mappings
        address_mappings: Mapping<Address, CrossChainAddress>,
        protocol_fee_bps: u16,
        protocol_fees: Balance,
        min_timelock: BlockNumber,
        max_timelock: BlockNumber,
    }

    /// Contract data with Address
    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct LockContract {
        pub sender: Address,
        pub receiver: Address,
        pub amount: Balance,
        pub hashlock: [u8; 32],
        pub timelock: BlockNumber,
        pub withdrawn: bool,
        pub refunded: bool,
        pub preimage: Option<[u8; 32]>,
        pub swap_id: [u8; 32],
        pub source_chain: u32,
        pub dest_chain: u32,
        pub dest_amount: Balance,
        pub fee: Balance,
        pub relayer: Option<Address>,
        pub sender_cross_address: Option<Vec<u8>>,
        pub receiver_cross_address: Option<Vec<u8>>,
    }

    #[ink(event)]
    pub struct AddressMapped {
        account: Address,
        cross_address: CrossChainAddress,
    }

    #[ink(event)]
    pub struct HTLCNew {
        #[ink(topic)]
        contract_id: [u8; 32],
        sender: Address,
        receiver: Address,
        amount: Balance,
        hashlock: [u8; 32],
        timelock: BlockNumber,
        swap_id: [u8; 32],
        source_chain: u32,
        dest_chain: u32,
        dest_amount: Balance,
    }

    #[ink(event)]
    pub struct HTLCWithdraw {
        #[ink(topic)]
        contract_id: [u8; 32],
        secret: [u8; 32],
        relayer: Option<Address>,
    }

    #[ink(event)]
    pub struct HTLCRefund {
        #[ink(topic)]
        contract_id: [u8; 32],
    }

    #[ink(event)]
    pub struct RelayerRegistered {
        contract_id: [u8; 32],
        relayer: Address,
    }

    #[derive(Debug, PartialEq, Eq, Encode, Decode, TypeInfo)]
    pub enum Error {
        ContractAlreadyExists,
        ContractNotFound,
        InvalidTimelock,
        InsufficientFunds,
        UnauthorizedWithdraw,
        UnauthorizedRefund,
        InvalidHashlock,
        AlreadyProcessed,
        TimelockNotExpired,
        TimelockExpired,
        TransferFailed,
        InvalidFee,
        InvalidChainId,
        RelayerAlreadySet,
        TimelockTooShort,
        TimelockTooLong,
        Unauthorized,
        ConversionError,
        Overflow,
    }

    impl Default for FusionHtlc {
        fn default() -> Self {
            Self::new()
        }
    }

    impl FusionHtlc {
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {
                contracts: Mapping::default(),
                contract_counter: 0,
                admin: Self::account_id_to_address(&Self::env().caller()),
                address_mappings: Mapping::default(),
                protocol_fee_bps: 30,
                protocol_fees: 0,
                min_timelock: 100,
                max_timelock: 14400,
            }
        }

        /// Convert AccountId to Address (32-byte array)
        fn account_id_to_address(account_id: &AccountId) -> Address {
            let mut address = [0u8; 32];
            let account_bytes = account_id.as_ref();
            address.copy_from_slice(account_bytes);
            address
        }

        /// Convert Address to AccountId
        fn address_to_account_id(address: &Address) -> AccountId {
            AccountId::from(*address)
        }

        /// Map cross-chain address for account
        #[ink(message)]
        pub fn map_address(&mut self, cross_address: CrossChainAddress) -> Result<(), Error> {
            let caller: Address = Self::account_id_to_address(&self.env().caller());
            self.address_mappings.insert(caller, &cross_address);
            
            self.env().emit_event(AddressMapped {
                account: caller,
                cross_address,
            });
            
            Ok(())
        }

        /// Create new HTLC contract with receiver as Address
        #[ink(message)]
        #[ink(payable)]
        #[allow(clippy::too_many_arguments)]
        pub fn new_contract(
            &mut self,
            receiver: Address,
            hashlock: [u8; 32],
            timelock: BlockNumber,
            swap_id: [u8; 32],
            source_chain: u32,
            dest_chain: u32,
            dest_amount: Balance,
            sender_cross_address: Option<Vec<u8>>,
            receiver_cross_address: Option<Vec<u8>>,
        ) -> Result<[u8; 32], Error> {
            let sender: Address = Self::account_id_to_address(&self.env().caller());
            let amount = self.get_transferred_balance()?;
            
            ink::env::debug_println!("🚀 NEW_CONTRACT called with timelock: {}", timelock);
            ink::env::debug_println!("🚀 NEW_CONTRACT about to call validate_contract_params");
            
            match self.validate_contract_params(timelock, source_chain, dest_chain) {
                Ok(()) => {
                    ink::env::debug_println!("🚀 NEW_CONTRACT: validate_contract_params returned OK");
                }
                Err(e) => {
                    ink::env::debug_println!("🚀 NEW_CONTRACT: validate_contract_params returned ERROR: {:?}", e);
                    return Err(e);
                }
            }
            
            let (net_amount, fee) = self.calculate_fees(amount)?;
            
            let contract_id = self.generate_contract_id(
                &sender,
                &receiver,
                net_amount,
                &hashlock,
                timelock,
                &swap_id,
            );

            if self.contracts.get(contract_id).is_some() {
                return Err(Error::ContractAlreadyExists);
            }

            let contract = LockContract {
                sender,
                receiver,
                amount: net_amount,
                hashlock,
                timelock,
                withdrawn: false,
                refunded: false,
                preimage: None,
                swap_id,
                source_chain,
                dest_chain,
                dest_amount,
                fee,
                relayer: None,
                sender_cross_address,
                receiver_cross_address,
            };

            self.contracts.insert(contract_id, &contract);
            self.protocol_fees = self.protocol_fees.checked_add(fee).ok_or(Error::Overflow)?;
            self.emit_htlc_new_event(&contract_id, &contract);

            Ok(contract_id)
        }

        #[ink(message)]
        pub fn register_relayer(&mut self, contract_id: [u8; 32]) -> Result<(), Error> {
            let caller: Address = Self::account_id_to_address(&self.env().caller());
            
            let mut contract = self.get_contract_or_error(&contract_id)?;

            if contract.relayer.is_some() {
                return Err(Error::RelayerAlreadySet);
            }

            contract.relayer = Some(caller);
            self.contracts.insert(contract_id, &contract);

            self.env().emit_event(RelayerRegistered {
                contract_id,
                relayer: caller,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn withdraw(
            &mut self,
            contract_id: [u8; 32],
            preimage: [u8; 32],
        ) -> Result<(), Error> {
            let caller: Address = Self::account_id_to_address(&self.env().caller());
            
            let mut contract = self.validate_withdrawal_auth(&contract_id, &caller)?;
            self.validate_withdrawal_timing(&contract)?;
            self.validate_preimage(&contract, &preimage)?;

            contract.withdrawn = true;
            contract.preimage = Some(preimage);
            self.contracts.insert(contract_id, &contract);

            self.execute_transfer(contract.receiver, contract.amount)?;

            self.env().emit_event(HTLCWithdraw {
                contract_id,
                secret: preimage,
                relayer: contract.relayer,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn refund(&mut self, contract_id: [u8; 32]) -> Result<(), Error> {
            let caller: Address = Self::account_id_to_address(&self.env().caller());
            
            let mut contract = self.validate_refund_auth(&contract_id, &caller)?;
            self.validate_refund_timing(&contract)?;

            contract.refunded = true;
            self.contracts.insert(contract_id, &contract);

            self.execute_transfer(contract.sender, contract.amount)?;

            self.env().emit_event(HTLCRefund { contract_id });

            Ok(())
        }

        // View functions
        #[ink(message)]
        pub fn get_contract(&self, contract_id: [u8; 32]) -> Option<LockContract> {
            self.contracts.get(contract_id)
        }

        #[ink(message)]
        pub fn contract_exists(&self, contract_id: [u8; 32]) -> bool {
            self.contracts.get(contract_id).is_some()
        }

        #[ink(message)]
        pub fn get_secret(&self, contract_id: [u8; 32]) -> Option<[u8; 32]> {
            self.contracts.get(contract_id)
                .and_then(|contract| contract.preimage)
        }

        #[ink(message)]
        pub fn get_cross_address(&self, account: Address) -> Option<CrossChainAddress> {
            self.address_mappings.get(account)
        }

        #[ink(message)]
        pub fn get_admin(&self) -> Address {
            self.admin
        }

        #[ink(message)]
        pub fn get_protocol_fee_bps(&self) -> u16 {
            self.protocol_fee_bps
        }

        #[ink(message)]
        pub fn get_protocol_fees(&self) -> Balance {
            self.protocol_fees
        }

        /// Get minimum timelock value
        #[ink(message)]
        pub fn get_min_timelock(&self) -> BlockNumber {
            self.min_timelock
        }

        /// Get maximum timelock value
        #[ink(message)]
        pub fn get_max_timelock(&self) -> BlockNumber {
            self.max_timelock
        }

        /// Get current block number (for debugging)
        #[ink(message)]
        pub fn get_current_block(&self) -> BlockNumber {
            self.env().block_number()
        }

        /// Debug function to test validate_contract_params directly
        #[ink(message)]
        pub fn debug_validate_contract_params(&self, timelock: BlockNumber, source_chain: u32, dest_chain: u32) -> Result<bool, Error> {
            self.validate_contract_params(timelock, source_chain, dest_chain)?;
            Ok(true)
        }

        /// Debug function to test timelock validation in isolation
        #[ink(message)]
        pub fn debug_timelock_validation(&self, timelock: BlockNumber) -> Result<bool, Error> {
            // Use the same validation logic as validate_contract_params to ensure consistency
            self.validate_timelock_internal(timelock)?;
            Ok(true)
        }

        // Admin functions
        #[ink(message)]
        pub fn update_admin(&mut self, new_admin: Address) -> Result<(), Error> {
            self.ensure_admin()?;
            self.admin = new_admin;
            Ok(())
        }

        #[ink(message)]
        pub fn update_protocol_fee(&mut self, new_fee_bps: u16) -> Result<(), Error> {
            self.ensure_admin()?;
            if new_fee_bps > 1000 {
                return Err(Error::InvalidFee);
            }
            self.protocol_fee_bps = new_fee_bps;
            Ok(())
        }

        #[ink(message)]
        pub fn withdraw_protocol_fees(&mut self) -> Result<(), Error> {
            self.ensure_admin()?;
            
            let fees = self.protocol_fees;
            if fees == 0 {
                return Err(Error::InsufficientFunds);
            }

            self.protocol_fees = 0;
            if self.execute_transfer(self.admin, fees).is_err() {
                self.protocol_fees = fees; // Restore on failure
                return Err(Error::TransferFailed);
            }

            Ok(())
        }

        // Private helper functions

        /// Get transferred value as Balance, ensuring non-zero amount
        fn get_transferred_balance(&self) -> Result<Balance, Error> {
            let amount = self.env().transferred_value();
            if amount == 0u128.into() {
                return Err(Error::InsufficientFunds);
            }
            // Convert U256 to u128 (Balance)
            let amount_u128: u128 = amount.try_into().map_err(|_| Error::ConversionError)?;
            Ok(amount_u128)
        }

        /// Shared timelock validation logic (single source of truth)
        fn validate_timelock_internal(&self, timelock: BlockNumber) -> Result<(), Error> {
            let current_block = self.env().block_number();

            ink::env::debug_println!(
                "🔍 TIMELOCK VALIDATION:\n  timelock: {}\n  current_block: {}\n  min_timelock: {}\n  max_timelock: {}",
                timelock, current_block, self.min_timelock, self.max_timelock
            );

            // First check: timelock must be in the future
            if timelock <= current_block {
                ink::env::debug_println!("❌ FAILED: timelock <= current_block ({} <= {})", timelock, current_block);
                return Err(Error::InvalidTimelock);
            }

            // Calculate the time difference from current block - use checked_sub to detect issues
            let time_diff = match timelock.checked_sub(current_block) {
                Some(diff) => diff,
                None => {
                    ink::env::debug_println!("❌ FAILED: timelock - current_block underflow");
                    return Err(Error::InvalidTimelock);
                }
            };
            
            ink::env::debug_println!("📊 Time difference: {} - {} = {}", timelock, current_block, time_diff);
            ink::env::debug_println!("📊 Comparison values: time_diff={}, min={}, max={}", time_diff, self.min_timelock, self.max_timelock);

            // Check minimum timelock
            if time_diff < self.min_timelock {
                ink::env::debug_println!("❌ FAILED: time_diff < min_timelock ({} < {})", time_diff, self.min_timelock);
                return Err(Error::TimelockTooShort);
            }

            // Check maximum timelock with explicit comparison
            ink::env::debug_println!("📊 Max check: {} > {} = {}", time_diff, self.max_timelock, time_diff > self.max_timelock);
            if time_diff > self.max_timelock {
                ink::env::debug_println!("❌ FAILED: time_diff > max_timelock ({} > {})", time_diff, self.max_timelock);
                return Err(Error::TimelockTooLong);
            }

            ink::env::debug_println!("✅ VALIDATION PASSED: time_diff {} is within valid range [{}, {}]", time_diff, self.min_timelock, self.max_timelock);
            Ok(())
        }

        /// Validate contract creation parameters with improved logic and debug logging
        fn validate_contract_params(
            &self,
            timelock: BlockNumber,
            source_chain: u32,
            dest_chain: u32,
        ) -> Result<(), Error> {
            // Use the shared timelock validation logic
            self.validate_timelock_internal(timelock)?;

            // Chain validation
            if source_chain == dest_chain {
                ink::env::debug_println!("❌ VALIDATION FAILED: source_chain == dest_chain ({} == {})", source_chain, dest_chain);
                return Err(Error::InvalidChainId);
            }

            Ok(())
        }

        /// Calculate protocol fees from amount
        fn calculate_fees(&self, amount: Balance) -> Result<(Balance, Balance), Error> {
            let fee = amount
                .checked_mul(self.protocol_fee_bps as u128)
                .ok_or(Error::Overflow)?
                .checked_div(10000)
                .ok_or(Error::Overflow)?;

            let net_amount = amount.checked_sub(fee).ok_or(Error::Overflow)?;
            Ok((net_amount, fee))
        }

        /// Get contract by ID or return error
        fn get_contract_or_error(&self, contract_id: &[u8; 32]) -> Result<LockContract, Error> {
            self.contracts.get(*contract_id).ok_or(Error::ContractNotFound)
        }

        /// Validate withdrawal authorization
        fn validate_withdrawal_auth(
            &self,
            contract_id: &[u8; 32],
            caller: &Address,
        ) -> Result<LockContract, Error> {
            let contract = self.get_contract_or_error(contract_id)?;

            if contract.receiver != *caller && contract.relayer.as_ref() != Some(caller) {
                return Err(Error::UnauthorizedWithdraw);
            }

            if contract.withdrawn || contract.refunded {
                return Err(Error::AlreadyProcessed);
            }

            Ok(contract)
        }

        /// Validate withdrawal timing (before timelock expires)
        fn validate_withdrawal_timing(&self, contract: &LockContract) -> Result<(), Error> {
            let current_block = self.env().block_number();
            if current_block >= contract.timelock {
                return Err(Error::TimelockExpired);
            }
            Ok(())
        }

        /// Validate refund authorization
        fn validate_refund_auth(
            &self,
            contract_id: &[u8; 32],
            caller: &Address,
        ) -> Result<LockContract, Error> {
            let contract = self.get_contract_or_error(contract_id)?;

            if contract.sender != *caller {
                return Err(Error::UnauthorizedRefund);
            }

            if contract.withdrawn || contract.refunded {
                return Err(Error::AlreadyProcessed);
            }

            Ok(contract)
        }

        /// Validate refund timing (after timelock expires)
        fn validate_refund_timing(&self, contract: &LockContract) -> Result<(), Error> {
            let current_block = self.env().block_number();
            if current_block < contract.timelock {
                return Err(Error::TimelockNotExpired);
            }
            Ok(())
        }

        /// Validate preimage matches hashlock
        fn validate_preimage(
            &self,
            contract: &LockContract,
            preimage: &[u8; 32],
        ) -> Result<(), Error> {
            let hash = self.compute_sha256(preimage);
            if hash != contract.hashlock {
                return Err(Error::InvalidHashlock);
            }
            Ok(())
        }

        /// Execute transfer for ink! v4.3.0
        fn execute_transfer(&self, to: Address, amount: Balance) -> Result<(), Error> {
            let account_id = Self::address_to_account_id(&to);
            self.env().transfer(account_id, amount)
                .map_err(|_| Error::TransferFailed)
        }

        /// Ensure caller is admin
        fn ensure_admin(&self) -> Result<(), Error> {
            let caller: Address = Self::account_id_to_address(&self.env().caller());
            if caller != self.admin {
                return Err(Error::Unauthorized);
            }
            Ok(())
        }

        /// Emit HTLC creation event
        fn emit_htlc_new_event(&self, contract_id: &[u8; 32], contract: &LockContract) {
            self.env().emit_event(HTLCNew {
                contract_id: *contract_id,
                sender: contract.sender,
                receiver: contract.receiver,
                amount: contract.amount,
                hashlock: contract.hashlock,
                timelock: contract.timelock,
                swap_id: contract.swap_id,
                source_chain: contract.source_chain,
                dest_chain: contract.dest_chain,
                dest_amount: contract.dest_amount,
            });
        }

        /// Generate unique contract ID from parameters
        #[allow(clippy::arithmetic_side_effects)]
        fn generate_contract_id(
            &mut self,
            sender: &Address,
            receiver: &Address,
            amount: Balance,
            hashlock: &[u8; 32],
            timelock: BlockNumber,
            swap_id: &[u8; 32],
        ) -> [u8; 32] {
            self.contract_counter += 1;
            
            let mut data = Vec::new();
            data.extend_from_slice(&sender.encode());
            data.extend_from_slice(&receiver.encode());
            data.extend_from_slice(&amount.to_le_bytes());
            data.extend_from_slice(hashlock);
            data.extend_from_slice(&timelock.to_le_bytes());
            data.extend_from_slice(swap_id);
            data.extend_from_slice(&self.contract_counter.to_le_bytes());

            self.compute_sha256(&data)
        }

        /// Compute SHA256 hash
        fn compute_sha256(&self, data: &[u8]) -> [u8; 32] {
            use ink::env::hash::{Sha2x256, HashOutput};
            let mut output = <Sha2x256 as HashOutput>::Type::default();
            ink::env::hash_bytes::<Sha2x256>(data, &mut output);
            output
        }
    }

    #[cfg(test)]
mod integration_tests {
    use super::polkadotrelayer::*;
    use ink::env::test;

    type TestEnv = ink::env::DefaultEnvironment;

    fn setup_test_env() -> (ink::env::test::DefaultAccounts<TestEnv>, FusionHtlc) {
        let accounts = ink::env::test::default_accounts::<TestEnv>();
        let htlc = FusionHtlc::new();
        
        // Set initial block number using advance_block
        ink::env::test::advance_block::<TestEnv>();
        
        (accounts, htlc)
    }

    fn create_test_contract(
        htlc: &mut FusionHtlc,
        sender: AccountId,
        receiver: AccountId,
        amount: u128,
        timelock_offset: u32,
    ) -> Result<[u8; 32], Error> {
        ink::env::test::set_caller::<TestEnv>(sender);
        ink::env::test::set_value_transferred::<TestEnv>(amount.into());
        
        let current_block = ink::env::test::get_current_block_number::<TestEnv>().unwrap_or(1);
        let timelock = current_block + timelock_offset;
        
        let receiver_address = FusionHtlc::account_id_to_address(&receiver);
        
        htlc.new_contract(
            receiver_address,
            [0x01; 32],  // hashlock
            timelock,
            [0x02; 32],  // swap_id
            1,           // source_chain (Ethereum)
            2,           // dest_chain (Polkadot)
            900,         // dest_amount
            Some(vec![0xaa, 0xbb, 0xcc]),  // sender_cross_address
            Some(vec![0xdd, 0xee, 0xff])   // receiver_cross_address
        )
    }

    #[ink::test]
    fn test_contract_creation_flow() {
        let (accounts, mut htlc) = setup_test_env();
        
        let contract_id = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            500
        ).expect("Contract creation should succeed");
        
        assert!(htlc.contract_exists(contract_id));
        
        let contract = htlc.get_contract(contract_id).unwrap();
        let alice_address = FusionHtlc::account_id_to_address(&accounts.alice);
        let bob_address = FusionHtlc::account_id_to_address(&accounts.bob);
        
        assert_eq!(contract.sender, alice_address);
        assert_eq!(contract.receiver, bob_address);
        assert_eq!(contract.amount, 997); // 1000 - 3 (0.3% fee)
        
        println!("✅ Contract creation flow test passed");
    }

    #[ink::test]
    fn test_insufficient_funds_error() {
        let (accounts, mut htlc) = setup_test_env();
        
        let result = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            0, // Zero amount
            500
        );
        
        assert_eq!(result.err(), Some(Error::InsufficientFunds));
        println!("✅ Insufficient funds error test passed");
    }

    #[ink::test]
    fn test_timelock_too_short_error() {
        let (accounts, mut htlc) = setup_test_env();
        
        let result = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            50 // Too short (less than min timelock of 100)
        );
        
        assert_eq!(result.err(), Some(Error::TimelockTooShort));
        println!("✅ Timelock too short error test passed");
    }

    #[ink::test]
    fn test_timelock_too_long_error() {
        let (accounts, mut htlc) = setup_test_env();
        
        let result = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            20000 // Too long (more than max timelock of 14400)
        );
        
        assert_eq!(result.err(), Some(Error::TimelockTooLong));
        println!("✅ Timelock too long error test passed");
    }

    #[ink::test]
    fn test_invalid_timelock_error() {
        let (accounts, mut htlc) = setup_test_env();
        
        ink::env::test::set_caller::<TestEnv>(accounts.alice);
        ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
        
        let current_block = ink::env::test::get_current_block_number::<TestEnv>().unwrap_or(1);
        let bob_address = FusionHtlc::account_id_to_address(&accounts.bob);
        
        // Try timelock in the past
        let result = htlc.new_contract(
            bob_address,
            [0x01; 32],
            current_block.saturating_sub(1), // Past timelock
            [0x02; 32],
            1, 2, 900,
            None, None
        );
        
        assert_eq!(result.err(), Some(Error::InvalidTimelock));
        println!("✅ Invalid timelock error test passed");
    }

    #[ink::test]
    fn test_invalid_chain_id_error() {
        let (accounts, mut htlc) = setup_test_env();
        
        ink::env::test::set_caller::<TestEnv>(accounts.alice);
        ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
        
        let current_block = ink::env::test::get_current_block_number::<TestEnv>().unwrap_or(1);
        let bob_address = FusionHtlc::account_id_to_address(&accounts.bob);
        
        let result = htlc.new_contract(
            bob_address,
            [0x01; 32],
            current_block + 200,
            [0x02; 32],
            1, 1, // Same chain IDs
            900,
            None, None
        );
        
        assert_eq!(result.err(), Some(Error::InvalidChainId));
        println!("✅ Invalid chain ID error test passed");
    }

    #[ink::test]
    fn test_contract_already_exists_error() {
        let (accounts, mut htlc) = setup_test_env();
        
        // Create first contract
        let _contract_id1 = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            500
        ).expect("First contract should succeed");
        
        // Try to create identical contract (should have same ID and fail)
        let result = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            500
        );
        
        assert_eq!(result.err(), Some(Error::ContractAlreadyExists));
        println!("✅ Contract already exists error test passed");
    }

    #[ink::test]
    fn test_multiple_contracts_different_params() {
        let (accounts, mut htlc) = setup_test_env();
        
        // Create multiple contracts with different parameters
        let contract_id1 = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            500
        ).expect("First contract should succeed");
        
        let contract_id2 = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.charlie,  // Different receiver
            1000,
            500
        ).expect("Second contract should succeed");
        
        let contract_id3 = create_test_contract(
            &mut htlc,
            accounts.bob,     // Different sender
            accounts.charlie,
            1000,
            500
        ).expect("Third contract should succeed");
        
        // All contracts should exist and be different
        assert!(htlc.contract_exists(contract_id1));
        assert!(htlc.contract_exists(contract_id2));
        assert!(htlc.contract_exists(contract_id3));
        
        assert_ne!(contract_id1, contract_id2);
        assert_ne!(contract_id2, contract_id3);
        assert_ne!(contract_id1, contract_id3);
        
        println!("✅ Multiple contracts with different parameters test passed");
    }

    #[ink::test]
    fn test_cross_chain_address_mapping_integration() {
        let (accounts, mut htlc) = setup_test_env();
        
        // Map addresses for Alice and Bob
        ink::env::test::set_caller::<TestEnv>(accounts.alice);
        let alice_eth_addr = CrossChainAddress::Ethereum([0x11; 20]);
        htlc.map_address(alice_eth_addr.clone()).unwrap();
        
        ink::env::test::set_caller::<TestEnv>(accounts.bob);
        let bob_substrate_addr = CrossChainAddress::Substrate([0x22; 32]);
        htlc.map_address(bob_substrate_addr.clone()).unwrap();
        
        // Create contract
        let contract_id = create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            500
        ).unwrap();
        
        // Verify mappings are preserved
        let alice_address = FusionHtlc::account_id_to_address(&accounts.alice);
        let bob_address = FusionHtlc::account_id_to_address(&accounts.bob);
        
        assert_eq!(htlc.get_cross_address(alice_address), Some(alice_eth_addr));
        assert_eq!(htlc.get_cross_address(bob_address), Some(bob_substrate_addr));
        
        // Verify contract was created correctly
        let contract = htlc.get_contract(contract_id).unwrap();
        assert_eq!(contract.sender, alice_address);
        assert_eq!(contract.receiver, bob_address);
        
        println!("✅ Cross-chain address mapping integration test passed");
    }

    #[ink::test]
    fn test_protocol_fee_accumulation() {
        let (accounts, mut htlc) = setup_test_env();
        
        let initial_fees = htlc.get_protocol_fees();
        assert_eq!(initial_fees, 0);
        
        // Create first contract
        create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.bob,
            1000,
            500
        ).unwrap();
        
        let fees_after_first = htlc.get_protocol_fees();
        assert_eq!(fees_after_first, 3); // 1000 * 30 / 10000 = 3
        
        // Create second contract
        create_test_contract(
            &mut htlc,
            accounts.alice,
            accounts.charlie,
            2000,
            500
        ).unwrap();
        
        let fees_after_second = htlc.get_protocol_fees();
        assert_eq!(fees_after_second, 9); // 3 + (2000 * 30 / 10000) = 3 + 6 = 9
        
        println!("✅ Protocol fee accumulation test passed");
    }

    #[ink::test]
    fn test_timelock_validation_edge_cases() {
        let (accounts, htlc) = setup_test_env();
        
        ink::env::test::set_caller::<TestEnv>(accounts.alice);
        let current_block = ink::env::test::get_current_block_number::<TestEnv>().unwrap_or(1);
        
        // Test minimum valid timelock
        let result = htlc.debug_timelock_validation(current_block + 100);
        assert!(result.is_ok());
        
        // Test maximum valid timelock
        let result = htlc.debug_timelock_validation(current_block + 14400);
        assert!(result.is_ok());
        
        // Test just below minimum
        let result = htlc.debug_timelock_validation(current_block + 99);
        assert_eq!(result.err(), Some(Error::TimelockTooShort));
        
        // Test just above maximum
        let result = htlc.debug_timelock_validation(current_block + 14401);
        assert_eq!(result.err(), Some(Error::TimelockTooLong));
        
        println!("✅ Timelock validation edge cases test passed");
    }
}
}