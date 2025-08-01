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
            
            self.validate_contract_params(timelock, source_chain, dest_chain)?;
            
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

        /// Validate contract creation parameters
        fn validate_contract_params(
            &self,
            timelock: BlockNumber,
            source_chain: u32,
            dest_chain: u32,
        ) -> Result<(), Error> {
            let current_block = self.env().block_number();

            if timelock <= current_block {
                return Err(Error::InvalidTimelock);
            }

            let min_lock = current_block.checked_add(self.min_timelock).ok_or(Error::Overflow)?;
            if timelock < min_lock {
                return Err(Error::TimelockTooShort);
            }

            let max_lock = current_block.checked_add(self.max_timelock).ok_or(Error::Overflow)?;
            if timelock > max_lock {
                return Err(Error::TimelockTooLong);
            }

            if source_chain == dest_chain {
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
    mod tests {
        use super::*;

        type TestEnv = ink::env::DefaultEnvironment;

        #[ink::test]
        fn test_constructor_initializes_correctly() {
            let htlc = FusionHtlc::new();
            assert_eq!(htlc.get_protocol_fee_bps(), 30);
            assert_eq!(htlc.get_protocol_fees(), 0);
            assert_eq!(htlc.contract_counter, 0);
        }

        #[ink::test]
        fn test_fee_calculation_accuracy() {
            let htlc = FusionHtlc::new();
            
            // Test with 1000 units at 30 basis points (0.3%)
            let (net_amount, fee) = htlc.calculate_fees(1000).unwrap();
            assert_eq!(fee, 3); // 1000 * 30 / 10000 = 3
            assert_eq!(net_amount, 997);
            
            // Test edge case with small amount
            let (net_small, fee_small) = htlc.calculate_fees(100).unwrap();
            assert_eq!(fee_small, 0); // 100 * 30 / 10000 = 0.3 -> 0 (integer division)
            assert_eq!(net_small, 100);
        }

        #[ink::test]
        fn test_address_mapping_functionality() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            
            let eth_address = CrossChainAddress::Ethereum([0x42; 20]);
            let result = htlc.map_address(eth_address.clone());
            assert!(result.is_ok());
            
            let mapped = htlc.get_cross_address(accounts.alice);
            assert_eq!(mapped, Some(eth_address));
        }

        #[ink::test]
        fn test_contract_creation_success() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            // Setup test environment
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            let result = htlc.new_contract(
                accounts.bob,        // receiver
                [0x01; 32],         // hashlock
                500,                // timelock (400 blocks from now)
                [0x02; 32],         // swap_id
                1,                  // source_chain (Ethereum)
                2,                  // dest_chain (Polkadot)
                900,                // dest_amount
                Some(vec![0xaa, 0xbb, 0xcc]),  // sender_cross_address
                Some(vec![0xdd, 0xee, 0xff])   // receiver_cross_address
            );

            assert!(result.is_ok());
            
            let contract_id = result.unwrap();
            assert!(htlc.contract_exists(contract_id));
            
            let contract = htlc.get_contract(contract_id).unwrap();
            assert_eq!(contract.sender, accounts.alice);
            assert_eq!(contract.receiver, accounts.bob);
            assert_eq!(contract.amount, 997); // 1000 - 3 (fee)
            assert_eq!(contract.source_chain, 1);
            assert_eq!(contract.dest_chain, 2);
            assert!(!contract.withdrawn);
            assert!(!contract.refunded);
        }

        #[ink::test]
        fn test_timelock_validation() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            // Test timelock too short
            let result = htlc.new_contract(
                accounts.bob, [0x01; 32], 150, [0x02; 32], 1, 2, 900, None, None
            );
            assert_eq!(result.err(), Some(Error::TimelockTooShort));

            // Test timelock too long
            let result = htlc.new_contract(
                accounts.bob, [0x01; 32], 20000, [0x02; 32], 1, 2, 900, None, None
            );
            assert_eq!(result.err(), Some(Error::TimelockTooLong));
        }

        #[ink::test]
        fn test_relayer_registration() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            // Create contract first
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            let contract_id = htlc.new_contract(
                accounts.bob, [0x01; 32], 500, [0x02; 32], 1, 2, 900, None, None
            ).unwrap();

            // Register relayer
            ink::env::test::set_caller::<TestEnv>(accounts.charlie);
            let result = htlc.register_relayer(contract_id);
            assert!(result.is_ok());

            let contract = htlc.get_contract(contract_id).unwrap();
            assert_eq!(contract.relayer, Some(accounts.charlie));
        }
    }
}