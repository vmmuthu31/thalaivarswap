#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod polkadotrelayer {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;
    use scale::{Encode, Decode};
    use scale_info::TypeInfo;

    /// Cross-chain address representation
    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub enum CrossChainAddress {
        Ethereum([u8; 20]),
        Substrate([u8; 32]),
        Raw(Vec<u8>),
    }

    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct PartialFillOrder {
        pub maker: Address,
        pub total_amount: Balance,
        pub filled_amount: Balance,
        pub min_fill_amount: Balance,
        pub hashlock: [u8; 32],
        pub timelock: BlockNumber,
        pub cancelled: bool,
        pub swap_id: [u8; 32],
        pub source_chain: u32,
        pub dest_chain: u32,
        pub dest_amount_per_unit: Balance, // Destination amount per source unit (scaled by 1e12)
        pub fee: Balance,
        pub allow_partial_fills: bool,
        pub max_fills: u32,
        pub current_fills: u32,
        pub sender_cross_address: Option<Vec<u8>>,
        pub receiver_cross_address: Option<Vec<u8>>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
    #[cfg_attr(feature = "std", derive(ink::storage::traits::StorageLayout))]
    pub struct FillExecution {
        pub order_id: [u8; 32],
        pub taker: Address,
        pub fill_amount: Balance,
        pub contract_id: [u8; 32],
        pub withdrawn: bool,
        pub refunded: bool,
        pub preimage: Option<[u8; 32]>,
        pub timestamp: u64,
    }

    #[ink(storage)]
    pub struct PolkadotPartialFills {
        orders: Mapping<[u8; 32], PartialFillOrder>,
        fills: Mapping<[u8; 32], FillExecution>,
        order_fills: Mapping<[u8; 32], Vec<[u8; 32]>>, // orderId => fillIds[]
        admin: Address,
        address_mappings: Mapping<Address, CrossChainAddress>,
        protocol_fee_bps: u16,
        protocol_fees: Balance,
        min_timelock: BlockNumber,
        max_timelock: BlockNumber,
        order_counter: u64,
        fill_counter: u64,
    }

    #[ink(event)]
    pub struct PartialFillOrderCreated {
        #[ink(topic)]
        order_id: [u8; 32],
        #[ink(topic)]
        maker: Address,
        total_amount: Balance,
        min_fill_amount: Balance,
        hashlock: [u8; 32],
        timelock: BlockNumber,
        swap_id: [u8; 32],
        source_chain: u32,
        dest_chain: u32,
        dest_amount_per_unit: Balance,
        allow_partial_fills: bool,
        max_fills: u32,
    }

    #[ink(event)]
    pub struct OrderFilled {
        #[ink(topic)]
        order_id: [u8; 32],
        #[ink(topic)]
        fill_id: [u8; 32],
        #[ink(topic)]
        taker: Address,
        fill_amount: Balance,
        dest_amount: Balance,
        contract_id: [u8; 32],
    }

    #[ink(event)]
    pub struct FillWithdrawn {
        #[ink(topic)]
        fill_id: [u8; 32],
        #[ink(topic)]
        secret: [u8; 32],
        #[ink(topic)]
        taker: Address,
    }

    #[ink(event)]
    pub struct FillRefunded {
        #[ink(topic)]
        fill_id: [u8; 32],
        #[ink(topic)]
        maker: Address,
    }

    #[ink(event)]
    pub struct OrderCancelled {
        #[ink(topic)]
        order_id: [u8; 32],
    }

    #[ink(event)]
    pub struct AddressMapped {
        #[ink(topic)]
        account: Address,
        cross_address: CrossChainAddress,
    }

    #[derive(Debug, PartialEq, Eq, Encode, Decode, TypeInfo)]
    pub enum Error {
        OrderAlreadyExists,
        OrderNotFound,
        FillNotFound,
        InvalidTimelock,
        InsufficientFunds,
        UnauthorizedFill,
        UnauthorizedWithdraw,
        UnauthorizedRefund,
        InvalidHashlock,
        AlreadyProcessed,
        TimelockNotExpired,
        TimelockExpired,
        TransferFailed,
        InvalidChainId,
        InvalidFillAmount,
        OrderCancelled,
        OrderCompleted,
        PartialFillsNotAllowed,
        MaxFillsReached,
        FillAmountTooSmall,
        InvalidFee,
        Unauthorized,
        ConversionError,
        TimelockTooShort,
        TimelockTooLong,
    }

    impl PolkadotPartialFills {
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {
                orders: Mapping::default(),
                fills: Mapping::default(),
                order_fills: Mapping::default(),
                admin: Self::env().caller(),
                address_mappings: Mapping::default(),
                protocol_fee_bps: 30,
                protocol_fees: 0,
                min_timelock: 100,
                max_timelock: 14400,
                order_counter: 0,
                fill_counter: 0,
            }
        }

        /// Map cross-chain address for account
        #[ink(message)]
        pub fn map_address(&mut self, cross_address: CrossChainAddress) -> Result<(), Error> {
            let caller = self.env().caller();
            self.address_mappings.insert(caller, &cross_address);
            
            self.env().emit_event(AddressMapped {
                account: caller,
                cross_address,
            });
            
            Ok(())
        }

        /// Create new partial fill order
        #[ink(message)]
        #[ink(payable)]
        pub fn create_partial_fill_order(
            &mut self,
            total_amount: Balance,
            min_fill_amount: Balance,
            hashlock: [u8; 32],
            timelock: BlockNumber,
            swap_id: [u8; 32],
            source_chain: u32,
            dest_chain: u32,
            dest_amount_per_unit: Balance,
            allow_partial_fills: bool,
            max_fills: u32,
            sender_cross_address: Option<Vec<u8>>,
            receiver_cross_address: Option<Vec<u8>>,
        ) -> Result<[u8; 32], Error> {
            let maker = self.env().caller();
            let transferred_amount = self.get_transferred_balance()?;
            
            self.validate_order_params(
                total_amount,
                min_fill_amount,
                timelock,
                source_chain,
                dest_chain,
                max_fills,
            )?;

            if transferred_amount < total_amount {
                return Err(Error::InsufficientFunds);
            }

            let (net_amount, fee) = self.calculate_fees(total_amount);
            
            let order_id = self.generate_order_id(
                &maker,
                net_amount,
                &hashlock,
                timelock,
                &swap_id,
            );

            if self.orders.contains(&order_id) {
                return Err(Error::OrderAlreadyExists);
            }

            let order = PartialFillOrder {
                maker,
                total_amount: net_amount,
                filled_amount: 0,
                min_fill_amount,
                hashlock,
                timelock,
                cancelled: false,
                swap_id,
                source_chain,
                dest_chain,
                dest_amount_per_unit,
                fee,
                allow_partial_fills,
                max_fills,
                current_fills: 0,
                sender_cross_address,
                receiver_cross_address,
            };

            self.orders.insert(&order_id, &order);
            self.protocol_fees += fee;

            self.env().emit_event(PartialFillOrderCreated {
                order_id,
                maker,
                total_amount: net_amount,
                min_fill_amount,
                hashlock,
                timelock,
                swap_id,
                source_chain,
                dest_chain,
                dest_amount_per_unit,
                allow_partial_fills,
                max_fills,
            });

            Ok(order_id)
        }

        /// Fill order (partial or full)
        #[ink(message)]
        pub fn fill_order(
            &mut self,
            order_id: [u8; 32],
            mut fill_amount: Balance,
            receiver: Address,
        ) -> Result<[u8; 32], Error> {
            let taker = self.env().caller();
            let mut order = self.get_order_or_error(&order_id)?;

            self.validate_fill_request(&order, fill_amount)?;

            let remaining_amount = order.total_amount - order.filled_amount;
            if fill_amount > remaining_amount {
                fill_amount = remaining_amount;
            }

            if fill_amount < order.min_fill_amount && remaining_amount > order.min_fill_amount {
                return Err(Error::FillAmountTooSmall);
            }

            if !order.allow_partial_fills && fill_amount < remaining_amount {
                return Err(Error::PartialFillsNotAllowed);
            }

            // Create fill execution
            let fill_id = self.generate_fill_id(&order_id, &taker, fill_amount);
            
            if self.fills.contains(&fill_id) {
                return Err(Error::OrderAlreadyExists);
            }

            let contract_id = self.generate_contract_id(&order_id, &fill_id);

            let fill = FillExecution {
                order_id,
                taker,
                fill_amount,
                contract_id,
                withdrawn: false,
                refunded: false,
                preimage: None,
                timestamp: self.env().block_timestamp(),
            };

            self.fills.insert(&fill_id, &fill);

            // Update order state
            order.filled_amount += fill_amount;
            order.current_fills += 1;
            self.orders.insert(&order_id, &order);

            // Add to order fills tracking
            let mut order_fill_list = self.order_fills.get(&order_id).unwrap_or_default();
            order_fill_list.push(fill_id);
            self.order_fills.insert(&order_id, &order_fill_list);

            let dest_amount = (fill_amount * order.dest_amount_per_unit) / 1_000_000_000_000; // Scale by 1e12

            self.env().emit_event(OrderFilled {
                order_id,
                fill_id,
                taker,
                fill_amount,
                dest_amount,
                contract_id,
            });

            Ok(fill_id)
        }

        /// Withdraw filled amount using preimage
        #[ink(message)]
        pub fn withdraw_fill(
            &mut self,
            fill_id: [u8; 32],
            preimage: [u8; 32],
        ) -> Result<(), Error> {
            let caller = self.env().caller();
            let mut fill = self.get_fill_or_error(&fill_id)?;
            let order = self.get_order_or_error(&fill.order_id)?;

            self.validate_fill_withdrawal(&fill, &order, &caller)?;
            self.validate_preimage(&order, &preimage)?;

            fill.withdrawn = true;
            fill.preimage = Some(preimage);
            self.fills.insert(&fill_id, &fill);

            self.execute_transfer(fill.taker, fill.fill_amount)?;

            self.env().emit_event(FillWithdrawn {
                fill_id,
                secret: preimage,
                taker: fill.taker,
            });

            Ok(())
        }

        /// Refund fill after timelock expires
        #[ink(message)]
        pub fn refund_fill(&mut self, fill_id: [u8; 32]) -> Result<(), Error> {
            let caller = self.env().caller();
            let mut fill = self.get_fill_or_error(&fill_id)?;
            let mut order = self.get_order_or_error(&fill.order_id)?;

            self.validate_fill_refund(&fill, &order, &caller)?;

            fill.refunded = true;
            self.fills.insert(&fill_id, &fill);

            // Update order filled amount (subtract refunded amount)
            order.filled_amount -= fill.fill_amount;
            order.current_fills -= 1;
            self.orders.insert(&fill.order_id, &order);

            self.execute_transfer(order.maker, fill.fill_amount)?;

            self.env().emit_event(FillRefunded {
                fill_id,
                maker: order.maker,
            });

            Ok(())
        }

        /// Cancel order and refund remaining amount
        #[ink(message)]
        pub fn cancel_order(&mut self, order_id: [u8; 32]) -> Result<(), Error> {
            let caller = self.env().caller();
            let mut order = self.get_order_or_error(&order_id)?;

            if caller != order.maker {
                return Err(Error::UnauthorizedRefund);
            }

            if order.cancelled {
                return Err(Error::OrderCancelled);
            }

            order.cancelled = true;
            self.orders.insert(&order_id, &order);

            let remaining_amount = order.total_amount - order.filled_amount;
            if remaining_amount > 0 {
                self.execute_transfer(order.maker, remaining_amount)?;
            }

            self.env().emit_event(OrderCancelled { order_id });

            Ok(())
        }

        // View functions
        #[ink(message)]
        pub fn get_order(&self, order_id: [u8; 32]) -> Option<PartialFillOrder> {
            self.orders.get(&order_id)
        }

        #[ink(message)]
        pub fn get_fill(&self, fill_id: [u8; 32]) -> Option<FillExecution> {
            self.fills.get(&fill_id)
        }

        #[ink(message)]
        pub fn get_order_fills(&self, order_id: [u8; 32]) -> Vec<[u8; 32]> {
            self.order_fills.get(&order_id).unwrap_or_default()
        }

        #[ink(message)]
        pub fn order_exists(&self, order_id: [u8; 32]) -> bool {
            self.orders.contains(&order_id)
        }

        #[ink(message)]
        pub fn get_remaining_amount(&self, order_id: [u8; 32]) -> Balance {
            if let Some(order) = self.orders.get(&order_id) {
                if order.cancelled || order.filled_amount >= order.total_amount {
                    return 0;
                }
                return order.total_amount - order.filled_amount;
            }
            0
        }

        #[ink(message)]
        pub fn is_order_complete(&self, order_id: [u8; 32]) -> bool {
            if let Some(order) = self.orders.get(&order_id) {
                return order.filled_amount >= order.total_amount;
            }
            false
        }

        #[ink(message)]
        pub fn get_fill_secret(&self, fill_id: [u8; 32]) -> Option<[u8; 32]> {
            self.fills.get(&fill_id).and_then(|fill| fill.preimage)
        }

        #[ink(message)]
        pub fn get_cross_address(&self, account: Address) -> Option<CrossChainAddress> {
            self.address_mappings.get(&account)
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
            if let Err(_) = self.execute_transfer(self.admin, fees) {
                self.protocol_fees = fees; // Restore on failure
                return Err(Error::TransferFailed);
            }

            Ok(())
        }

        // Private helper functions
        fn get_transferred_balance(&self) -> Result<Balance, Error> {
            let amount = self.env().transferred_value();
            if amount == 0u128.into() {
                return Err(Error::InsufficientFunds);
            }
            amount.try_into().map_err(|_| Error::ConversionError)
        }

        fn validate_order_params(
            &self,
            total_amount: Balance,
            min_fill_amount: Balance,
            timelock: BlockNumber,
            source_chain: u32,
            dest_chain: u32,
            max_fills: u32,
        ) -> Result<(), Error> {
            let current_block = self.env().block_number();

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

            if min_fill_amount == 0 || min_fill_amount > total_amount {
                return Err(Error::InvalidFillAmount);
            }

            if max_fills == 0 {
                return Err(Error::InvalidFillAmount);
            }

            Ok(())
        }

        fn validate_fill_request(
            &self,
            order: &PartialFillOrder,
            fill_amount: Balance,
        ) -> Result<(), Error> {
            if order.cancelled {
                return Err(Error::OrderCancelled);
            }

            let current_block = self.env().block_number();
            if current_block >= order.timelock {
                return Err(Error::TimelockExpired);
            }

            if order.filled_amount >= order.total_amount {
                return Err(Error::OrderCompleted);
            }

            if order.current_fills >= order.max_fills {
                return Err(Error::MaxFillsReached);
            }

            if fill_amount == 0 {
                return Err(Error::InvalidFillAmount);
            }

            Ok(())
        }

        fn validate_fill_withdrawal(
            &self,
            fill: &FillExecution,
            order: &PartialFillOrder,
            caller: &Address,
        ) -> Result<(), Error> {
            if *caller != fill.taker {
                return Err(Error::UnauthorizedWithdraw);
            }

            if fill.withdrawn || fill.refunded {
                return Err(Error::AlreadyProcessed);
            }

            let current_block = self.env().block_number();
            if current_block >= order.timelock {
                return Err(Error::TimelockExpired);
            }

            Ok(())
        }

        fn validate_fill_refund(
            &self,
            fill: &FillExecution,
            order: &PartialFillOrder,
            caller: &Address,
        ) -> Result<(), Error> {
            if *caller != order.maker {
                return Err(Error::UnauthorizedRefund);
            }

            if fill.withdrawn || fill.refunded {
                return Err(Error::AlreadyProcessed);
            }

            let current_block = self.env().block_number();
            if current_block < order.timelock {
                return Err(Error::TimelockNotExpired);
            }

            Ok(())
        }

        fn validate_preimage(
            &self,
            order: &PartialFillOrder,
            preimage: &[u8; 32],
        ) -> Result<(), Error> {
            let hash = self.compute_sha256(preimage);
            if hash != order.hashlock {
                return Err(Error::InvalidHashlock);
            }
            Ok(())
        }

        fn calculate_fees(&self, amount: Balance) -> (Balance, Balance) {
            let fee = (amount * self.protocol_fee_bps as u128) / 10000;
            let net_amount = amount - fee;
            (net_amount, fee)
        }

        fn get_order_or_error(&self, order_id: &[u8; 32]) -> Result<PartialFillOrder, Error> {
            self.orders.get(order_id).ok_or(Error::OrderNotFound)
        }

        fn get_fill_or_error(&self, fill_id: &[u8; 32]) -> Result<FillExecution, Error> {
            self.fills.get(fill_id).ok_or(Error::FillNotFound)
        }

        fn execute_transfer(&self, to: Address, amount: Balance) -> Result<(), Error> {
            let amount_u256: ink::primitives::U256 = amount.into();
            self.env().transfer(to, amount_u256)
                .map_err(|_| Error::TransferFailed)
        }

        fn ensure_admin(&self) -> Result<(), Error> {
            if self.env().caller() != self.admin {
                return Err(Error::Unauthorized);
            }
            Ok(())
        }

        fn generate_order_id(
            &mut self,
            maker: &Address,
            amount: Balance,
            hashlock: &[u8; 32],
            timelock: BlockNumber,
            swap_id: &[u8; 32],
        ) -> [u8; 32] {
            self.order_counter += 1;
            
            let mut data = Vec::new();
            data.extend_from_slice(&maker.encode());
            data.extend_from_slice(&amount.to_le_bytes());
            data.extend_from_slice(hashlock);
            data.extend_from_slice(&timelock.to_le_bytes());
            data.extend_from_slice(swap_id);
            data.extend_from_slice(&self.order_counter.to_le_bytes());

            self.compute_sha256(&data)
        }

        fn generate_fill_id(
            &self,
            order_id: &[u8; 32],
            taker: &Address,
            fill_amount: Balance,
        ) -> [u8; 32] {
            let mut data = Vec::new();
            data.extend_from_slice(order_id);
            data.extend_from_slice(&taker.encode());
            data.extend_from_slice(&fill_amount.to_le_bytes());
            data.extend_from_slice(&self.env().block_timestamp().to_le_bytes());
            data.extend_from_slice(&self.env().block_number().to_le_bytes());

            self.compute_sha256(&data)
        }

        fn generate_contract_id(&mut self, order_id: &[u8; 32], fill_id: &[u8; 32]) -> [u8; 32] {
            self.fill_counter += 1;
            
            let mut data = Vec::new();
            data.extend_from_slice(order_id);
            data.extend_from_slice(fill_id);
            data.extend_from_slice(&self.env().block_timestamp().to_le_bytes());
            data.extend_from_slice(&self.fill_counter.to_le_bytes());

            self.compute_sha256(&data)
        }

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
        fn test_partial_fill_order_creation() {
            let mut contract = PolkadotPartialFills::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            let result = contract.create_partial_fill_order(
                1000,                    // total_amount
                100,                     // min_fill_amount
                [0x01; 32],             // hashlock
                500,                     // timelock
                [0x02; 32],             // swap_id
                1,                       // source_chain
                2,                       // dest_chain
                1_000_000_000_000,      // dest_amount_per_unit (1:1 ratio scaled)
                true,                    // allow_partial_fills
                5,                       // max_fills
                None,                    // sender_cross_address
                None,                    // receiver_cross_address
            );

            assert!(result.is_ok());
            
            let order_id = result.unwrap();
            assert!(contract.order_exists(order_id));
            
            let order = contract.get_order(order_id).unwrap();
            assert_eq!(order.maker, accounts.alice);
            assert_eq!(order.total_amount, 997); // 1000 - 3 (fee)
            assert_eq!(order.filled_amount, 0);
            assert_eq!(order.min_fill_amount, 100);
            assert!(order.allow_partial_fills);
            assert_eq!(order.max_fills, 5);
            assert_eq!(order.current_fills, 0);
        }

        #[ink::test]
        fn test_partial_fill_execution() {
            let mut contract = PolkadotPartialFills::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            // Create order
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            let order_id = contract.create_partial_fill_order(
                1000, 100, [0x01; 32], 500, [0x02; 32], 1, 2, 
                1_000_000_000_000, true, 5, None, None
            ).unwrap();

            // Fill order partially
            ink::env::test::set_caller::<TestEnv>(accounts.bob);
            let fill_result = contract.fill_order(order_id, 200, accounts.charlie);
            assert!(fill_result.is_ok());

            let fill_id = fill_result.unwrap();
            let fill = contract.get_fill(fill_id).unwrap();
            assert_eq!(fill.taker, accounts.bob);
            assert_eq!(fill.fill_amount, 200);
            assert!(!fill.withdrawn);
            assert!(!fill.refunded);

            // Check order state
            let order = contract.get_order(order_id).unwrap();
            assert_eq!(order.filled_amount, 200);
            assert_eq!(order.current_fills, 1);
            assert_eq!(contract.get_remaining_amount(order_id), 797); // 997 - 200
        }

        #[ink::test]
        fn test_multiple_partial_fills() {
            let mut contract = PolkadotPartialFills::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            // Create order
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            let order_id = contract.create_partial_fill_order(
                1000, 100, [0x01; 32], 500, [0x02; 32], 1, 2, 
                1_000_000_000_000, true, 3, None, None
            ).unwrap();

            // First fill
            ink::env::test::set_caller::<TestEnv>(accounts.bob);
            let fill1_id = contract.fill_order(order_id, 200, accounts.charlie).unwrap();

            // Second fill
            ink::env::test::set_caller::<TestEnv>(accounts.charlie);
            let fill2_id = contract.fill_order(order_id, 300, accounts.bob).unwrap();

            // Check order state
            let order = contract.get_order(order_id).unwrap();
            assert_eq!(order.filled_amount, 500); // 200 + 300
            assert_eq!(order.current_fills, 2);
            assert_eq!(contract.get_remaining_amount(order_id), 497); // 997 - 500

            // Check fills tracking
            let order_fills = contract.get_order_fills(order_id);
            assert_eq!(order_fills.len(), 2);
            assert!(order_fills.contains(&fill1_id));
            assert!(order_fills.contains(&fill2_id));
        }

        #[ink::test]
        fn test_fill_withdrawal_with_secret() {
            let mut contract = PolkadotPartialFills::new();
            let accounts = ink::env::test::default_accounts::<TestEnv>();
            
            // Create order
            ink::env::test::set_caller::<TestEnv>(accounts.alice);
            ink::env::test::set_value_transferred::<TestEnv>(1000u128.into());
            ink::env::test::set_block_number::<TestEnv>(100);

            let secret = [0x42; 32];
            let hashlock = contract.compute_sha256(&secret);

            let order_id = contract.create_partial_fill_order(
                1000, 100, hashlock, 500, [0x02; 32], 1, 2, 
                1_000_000_000_000, true, 5, None, None
            ).unwrap();

            // Fill order
            ink::env::test::set_caller::<TestEnv>(accounts.bob);
            let fill_id = contract.fill_order(order_id, 200, accounts.charlie).unwrap();

            // Withdraw with correct secret
            let withdraw_result = contract.withdraw_fill(fill_id, secret);
            assert!(withdraw_result.is_ok());

            let fill = contract.get_fill(fill_id).unwrap();
            assert!(fill.withdrawn);
            assert_eq!(fill.preimage, Some(secret));
        }
    }
}