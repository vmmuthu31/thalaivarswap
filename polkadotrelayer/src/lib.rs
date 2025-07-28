#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod polkadotrelayer {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;
    use scale::{Encode, Decode};
    use scale_info::TypeInfo;

    /// The main HTLC contract for cross-chain swaps
    #[ink(storage)]
    pub struct FusionHtlc {
        contracts: Mapping<[u8; 32], LockContract>,
        contract_counter: u64,
        admin: Address,
        /// Fee collected by the protocol (in basis points, e.g., 30 = 0.3%)
        protocol_fee_bps: u16,
        /// Accumulated protocol fees
        protocol_fees: Balance,
        /// Minimum timelock duration (in blocks)
        min_timelock: BlockNumber,
        /// Maximum timelock duration (in blocks) 
        max_timelock: BlockNumber,
    }

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
        /// The destination chain for this swap
        pub dest_chain: u32,
        /// The expected amount on destination chain
        pub dest_amount: Balance,
        /// Fee for this specific swap
        pub fee: Balance,
        /// Relayer responsible for this swap
        pub relayer: Option<Address>,
    }

    #[ink(event)]
    pub struct HTLCNew {
        #[ink(topic)]
        contract_id: [u8; 32],
        #[ink(topic)]
        sender: Address,
        #[ink(topic)]
        receiver: Address,
        amount: Balance,
        hashlock: [u8; 32],
        timelock: BlockNumber,
        swap_id: [u8; 32],
        source_chain: u32,
        dest_chain: u32,
        dest_amount: Balance,
        relayer: Option<Address>,
    }

    #[ink(event)]
    pub struct HTLCWithdraw {
        #[ink(topic)]
        contract_id: [u8; 32],
        #[ink(topic)]
        secret: [u8; 32],
        #[ink(topic)]
        relayer: Option<Address>,
    }

    #[ink(event)]
    pub struct HTLCRefund {
        #[ink(topic)]
        contract_id: [u8; 32],
    }

    /// Event emitted when a relayer registers for a swap
    #[ink(event)]
    pub struct RelayerRegistered {
        #[ink(topic)]
        contract_id: [u8; 32],
        #[ink(topic)]
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
        ConversionError,
        InvalidFee,
        InvalidChainId,
        RelayerAlreadySet,
        UnauthorizedRelayer,
        TimelockTooShort,
        TimelockTooLong,
    }

    impl FusionHtlc {
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {
                contracts: Mapping::default(),
                contract_counter: 0,
                admin: Self::env().caller(),
                protocol_fee_bps: 30, // 0.3% default fee
                protocol_fees: 0,
                min_timelock: 100,    // ~10 minutes (assuming 6s blocks)
                max_timelock: 14400,  // ~24 hours
            }
        }

        /// Create a new HTLC for cross-chain swap
        #[ink(message)]
        #[ink(payable)]
        pub fn new_contract(
            &mut self,
            receiver: Address,
            hashlock: [u8; 32],
            timelock: BlockNumber,
            swap_id: [u8; 32],
            source_chain: u32,
            dest_chain: u32,
            dest_amount: Balance,
        ) -> Result<[u8; 32], Error> {
            let sender = self.env().caller();
            let amount = self.env().transferred_value();
            let current_block = self.env().block_number();

            // Validation
            if amount == 0u128.into() {
                return Err(Error::InsufficientFunds);
            }

            if timelock <= current_block {
                return Err(Error::InvalidTimelock);
            }

            if timelock < current_block + self.min_timelock {
                return Err(Error::TimelockTooShort);
            }

            if timelock > current_block + self.max_timelock {
                return Err(Error::TimelockTooLong);
            }

            if source_chain == dest_chain {
                return Err(Error::InvalidChainId);
            }

            let amount_balance: Balance = self.convert_u256_to_balance(amount)?;
            
            // Calculate protocol fee
            let fee = (amount_balance * self.protocol_fee_bps as u128) / 10000;
            let net_amount = amount_balance - fee;

            let contract_id = self.generate_contract_id(
                &sender,
                &receiver,
                net_amount,
                &hashlock,
                timelock,
                &swap_id,
            );

            if self.contracts.contains(&contract_id) {
                return Err(Error::ContractAlreadyExists);
            }

            let lock_contract = LockContract {
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
            };

            self.contracts.insert(&contract_id, &lock_contract);
            self.protocol_fees += fee;

            self.env().emit_event(HTLCNew {
                contract_id,
                sender,
                receiver,
                amount: net_amount,
                hashlock,
                timelock,
                swap_id,
                source_chain,
                dest_chain,
                dest_amount,
                relayer: None,
            });

            Ok(contract_id)
        }

        /// Register a relayer for a specific swap
        #[ink(message)]
        pub fn register_relayer(&mut self, contract_id: [u8; 32]) -> Result<(), Error> {
            let caller = self.env().caller();
            
            let mut contract = self.contracts.get(&contract_id)
                .ok_or(Error::ContractNotFound)?;

            if contract.relayer.is_some() {
                return Err(Error::RelayerAlreadySet);
            }

            contract.relayer = Some(caller);
            self.contracts.insert(&contract_id, &contract);

            self.env().emit_event(RelayerRegistered {
                contract_id,
                relayer: caller,
            });

            Ok(())
        }

        /// Withdraw funds using the preimage (secret)
        #[ink(message)]
        pub fn withdraw(
            &mut self,
            contract_id: [u8; 32],
            preimage: [u8; 32],
        ) -> Result<(), Error> {
            let caller = self.env().caller();
            let current_block = self.env().block_number();

            let mut contract = self.contracts.get(&contract_id)
                .ok_or(Error::ContractNotFound)?;

            // Only receiver or registered relayer can withdraw
            if contract.receiver != caller && contract.relayer != Some(caller) {
                return Err(Error::UnauthorizedWithdraw);
            }

            if contract.withdrawn || contract.refunded {
                return Err(Error::AlreadyProcessed);
            }

            if current_block >= contract.timelock {
                return Err(Error::TimelockExpired);
            }

            let hash = self.sha256(&preimage);
            if hash != contract.hashlock {
                return Err(Error::InvalidHashlock);
            }

            contract.withdrawn = true;
            contract.preimage = Some(preimage);
            self.contracts.insert(&contract_id, &contract);

            let amount_u256 = self.convert_balance_to_u256(contract.amount);
            if self.env().transfer(contract.receiver, amount_u256).is_err() {
                return Err(Error::TransferFailed);
            }

            self.env().emit_event(HTLCWithdraw {
                contract_id,
                secret: preimage,
                relayer: contract.relayer,
            });

            Ok(())
        }

        /// Refund the sender after timelock expires
        #[ink(message)]
        pub fn refund(&mut self, contract_id: [u8; 32]) -> Result<(), Error> {
            let caller = self.env().caller();
            let current_block = self.env().block_number();

            let mut contract = self.contracts.get(&contract_id)
                .ok_or(Error::ContractNotFound)?;

            if contract.sender != caller {
                return Err(Error::UnauthorizedRefund);
            }

            if contract.withdrawn || contract.refunded {
                return Err(Error::AlreadyProcessed);
            }

            if current_block < contract.timelock {
                return Err(Error::TimelockNotExpired);
            }

            contract.refunded = true;
            self.contracts.insert(&contract_id, &contract);

            let amount_u256 = self.convert_balance_to_u256(contract.amount);
            if self.env().transfer(contract.sender, amount_u256).is_err() {
                return Err(Error::TransferFailed);
            }

            self.env().emit_event(HTLCRefund { contract_id });

            Ok(())
        }

        /// Get contract details
        #[ink(message)]
        pub fn get_contract(&self, contract_id: [u8; 32]) -> Option<LockContract> {
            self.contracts.get(&contract_id)
        }

        /// Check if contract exists
        #[ink(message)]
        pub fn contract_exists(&self, contract_id: [u8; 32]) -> bool {
            self.contracts.contains(&contract_id)
        }

        /// Get the secret if revealed
        #[ink(message)]
        pub fn get_secret(&self, contract_id: [u8; 32]) -> Option<[u8; 32]> {
            self.contracts.get(&contract_id)
                .and_then(|contract| contract.preimage)
        }

        /// Admin functions
        #[ink(message)]
        pub fn get_admin(&self) -> Address {
            self.admin
        }

        #[ink(message)]
        pub fn update_admin(&mut self, new_admin: Address) -> Result<(), Error> {
            let caller = self.env().caller();
            if caller != self.admin {
                return Err(Error::UnauthorizedWithdraw); 
            }
            self.admin = new_admin;
            Ok(())
        }

        #[ink(message)]
        pub fn update_protocol_fee(&mut self, new_fee_bps: u16) -> Result<(), Error> {
            let caller = self.env().caller();
            if caller != self.admin {
                return Err(Error::UnauthorizedWithdraw);
            }
            if new_fee_bps > 1000 { // Max 10%
                return Err(Error::InvalidFee);
            }
            self.protocol_fee_bps = new_fee_bps;
            Ok(())
        }

        #[ink(message)]
        pub fn withdraw_protocol_fees(&mut self) -> Result<(), Error> {
            let caller = self.env().caller();
            if caller != self.admin {
                return Err(Error::UnauthorizedWithdraw);
            }
            
            let fees = self.protocol_fees;
            if fees == 0 {
                return Err(Error::InsufficientFunds);
            }

            self.protocol_fees = 0;
            let amount_u256 = self.convert_balance_to_u256(fees);
            if self.env().transfer(self.admin, amount_u256).is_err() {
                self.protocol_fees = fees; // Restore on failure
                return Err(Error::TransferFailed);
            }

            Ok(())
        }

        /// View functions
        #[ink(message)]
        pub fn get_protocol_fee_bps(&self) -> u16 {
            self.protocol_fee_bps
        }

        #[ink(message)]
        pub fn get_protocol_fees(&self) -> Balance {
            self.protocol_fees
        }

        /// Internal functions
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

            self.sha256(&data)
        }

        fn sha256(&self, data: &[u8]) -> [u8; 32] {
            use ink::env::hash::{Sha2x256, HashOutput};
            let mut output = <Sha2x256 as HashOutput>::Type::default();
            ink::env::hash_bytes::<Sha2x256>(data, &mut output);
            output
        }

        fn convert_u256_to_balance(&self, amount: ink::primitives::U256) -> Result<Balance, Error> {
            let amount_u128: u128 = amount.try_into().map_err(|_| Error::ConversionError)?;
            Ok(amount_u128)
        }

        fn convert_balance_to_u256(&self, amount: Balance) -> ink::primitives::U256 {
            amount.into()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use ink::env::DefaultEnvironment;

        #[ink::test]
        fn test_enhanced_new_contract() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts();
            
            let receiver = accounts.bob;
            let hashlock = [1u8; 32];
            let timelock = 1000;
            let swap_id = [2u8; 32];
            let source_chain = 1;
            let dest_chain = 2;
            let dest_amount = 90u128;

            ink::env::test::set_caller(accounts.alice);
            ink::env::test::set_value_transferred(100u128.into());
            ink::env::test::set_block_number::<DefaultEnvironment>(100);

            let result = htlc.new_contract(
                receiver, 
                hashlock, 
                timelock, 
                swap_id, 
                source_chain, 
                dest_chain, 
                dest_amount
            );
            assert!(result.is_ok());
            
            let contract_id = result.unwrap();
            assert!(htlc.contract_exists(contract_id));
            
            let contract = htlc.get_contract(contract_id).unwrap();
            assert_eq!(contract.dest_chain, dest_chain);
            assert_eq!(contract.dest_amount, dest_amount);
        }

        #[ink::test]
        fn test_relayer_registration() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts();
            
            ink::env::test::set_caller(accounts.alice);
            ink::env::test::set_value_transferred(100u128.into());
            ink::env::test::set_block_number::<DefaultEnvironment>(100);

            let contract_id = htlc.new_contract(
                accounts.bob,
                [1u8; 32],
                1000,
                [2u8; 32],
                1,
                2,
                90u128
            ).unwrap();

            // Register relayer
            ink::env::test::set_caller(accounts.charlie);
            let result = htlc.register_relayer(contract_id);
            assert!(result.is_ok());

            let contract = htlc.get_contract(contract_id).unwrap();
            assert_eq!(contract.relayer, Some(accounts.charlie));
        }
    }
}