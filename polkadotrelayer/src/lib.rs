#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod polkadotrelayer {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;
    use scale::{Encode, Decode};
    use scale_info::TypeInfo;
    use ink::storage::traits::StorageLayout;

    #[ink(storage)]
    pub struct FusionHtlc {
        contracts: Mapping<[u8; 32], LockContract>,
        contract_counter: u64,
        admin: Address,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo, StorageLayout)]
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
    }

    #[ink(event)]
    pub struct HTLCWithdraw {
        #[ink(topic)]
        contract_id: [u8; 32],
        #[ink(topic)]
        secret: [u8; 32],
    }

    #[ink(event)]
    pub struct HTLCRefund {
        #[ink(topic)]
        contract_id: [u8; 32],
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
    }

    impl FusionHtlc {
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {
                contracts: Mapping::default(),
                contract_counter: 0,
                admin: Self::env().caller(),
            }
        }

        #[ink(message)]
        #[ink(payable)]
        pub fn new_contract(
            &mut self,
            receiver: Address,
            hashlock: [u8; 32],
            timelock: BlockNumber,
            swap_id: [u8; 32],
            source_chain: u32,
        ) -> Result<[u8; 32], Error> {
            let sender = self.env().caller();
            let amount = self.env().transferred_value();
            let current_block = self.env().block_number();

            if amount == 0u128.into() {
                return Err(Error::InsufficientFunds);
            }

            if timelock <= current_block {
                return Err(Error::InvalidTimelock);
            }

            let amount_balance: Balance = self.convert_u256_to_balance(amount)?;

            let contract_id = self.generate_contract_id(
                &sender,
                &receiver,
                amount_balance,
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
                amount: amount_balance,
                hashlock,
                timelock,
                withdrawn: false,
                refunded: false,
                preimage: None,
                swap_id,
                source_chain,
            };

            self.contracts.insert(&contract_id, &lock_contract);

            self.env().emit_event(HTLCNew {
                contract_id,
                sender,
                receiver,
                amount: amount_balance,
                hashlock,
                timelock,
                swap_id,
            });

            Ok(contract_id)
        }

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

            if contract.receiver != caller {
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

            // Emit event
            self.env().emit_event(HTLCWithdraw {
                contract_id,
                secret: preimage,
            });

            Ok(())
        }

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

        #[ink(message)]
        pub fn get_contract(&self, contract_id: [u8; 32]) -> Option<LockContract> {
            self.contracts.get(&contract_id)
        }

        #[ink(message)]
        pub fn contract_exists(&self, contract_id: [u8; 32]) -> bool {
            self.contracts.contains(&contract_id)
        }

        #[ink(message)]
        pub fn get_secret(&self, contract_id: [u8; 32]) -> Option<[u8; 32]> {
            self.contracts.get(&contract_id)
                .and_then(|contract| contract.preimage)
        }

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
        fn test_new_contract() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts();
            
            let receiver = accounts.bob;
            let hashlock = [1u8; 32];
            let timelock = 1000;
            let swap_id = [2u8; 32];
            let source_chain = 1;

            ink::env::test::set_caller(accounts.alice);
            ink::env::test::set_value_transferred(100u128.into());

            let result = htlc.new_contract(receiver, hashlock, timelock, swap_id, source_chain);
            assert!(result.is_ok());
            
            let contract_id = result.unwrap();
            assert!(htlc.contract_exists(contract_id));
        }

        #[ink::test]
        fn test_withdraw() {
            let mut htlc = FusionHtlc::new();
            let accounts = ink::env::test::default_accounts();
            
            let receiver = accounts.bob;
            let preimage = [3u8; 32];
            let hashlock = htlc.sha256(&preimage);
            let timelock = 1000;
            let swap_id = [2u8; 32];
            let source_chain = 1;

            ink::env::test::set_caller(accounts.alice);
            ink::env::test::set_value_transferred(100u128.into());
            ink::env::test::set_block_number::<DefaultEnvironment>(500);

            let contract_id = htlc.new_contract(receiver, hashlock, timelock, swap_id, source_chain).unwrap();

            ink::env::test::set_caller(receiver);
            let result = htlc.withdraw(contract_id, preimage);
            assert!(result.is_ok());

            let contract = htlc.get_contract(contract_id).unwrap();
            assert!(contract.withdrawn);
            assert_eq!(contract.preimage, Some(preimage));
        }

        #[ink::test]
        fn test_admin_functions() {
            let accounts = ink::env::test::default_accounts();
            
            ink::env::test::set_caller(accounts.alice);
            
            let mut htlc = FusionHtlc::new();
            
            let initial_admin = htlc.get_admin();
            assert_eq!(initial_admin, accounts.alice, "Initial admin should be Alice");

            let update_result = htlc.update_admin(accounts.bob);
            assert!(update_result.is_ok(), "Admin update by Alice should succeed");

            let new_admin = htlc.get_admin();
            assert_eq!(new_admin, accounts.bob, "New admin should be Bob");

            ink::env::test::set_caller(accounts.charlie);
            let unauthorized_update = htlc.update_admin(accounts.charlie);
            assert!(unauthorized_update.is_err(), "Unauthorized admin update should fail");

            let final_admin = htlc.get_admin();
            assert_eq!(final_admin, accounts.bob, "Admin should still be Bob after failed update");
        }
    }
}
