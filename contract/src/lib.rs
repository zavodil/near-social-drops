use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::UnorderedMap;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::wee_alloc;
use near_sdk::json_types::U128;
use near_sdk::{env, near_bindgen, AccountId, Balance, Promise, Gas, ext_contract, PromiseResult, PromiseOrValue};
use std::collections::HashMap;

#[ext_contract(auth)]
pub trait ExtAuth {
    fn is_owner(&self, account_id: AccountId, contact: Contact) -> bool;
}

#[ext_contract(ext_self)]
pub trait ExtNearDrops {
    fn on_is_owner_on_claim(&mut self,
                            #[callback] contacts: Option<Vec<Contact>>,
                            drop_id: DropId,
                            recipient_account_id: AccountId,
                            recipient_contact: Contact,
                            balance_to_claim: Balance) -> PromiseOrValue<bool>;

    fn on_claim_complete(&mut self,
                         drop_id: DropId,
                         account_id: AccountId,
                         contact: Contact,
                         balance_to_claim: Balance) -> bool;
}


#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

const MAX_USERS_SIZE: usize = 32;
const MIN_DEPOSIT_AMOUNT: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_DESCRIPTION_LENGTH: usize = 280;
const MAX_TITLE_LENGTH: usize = 128;

const BASE_GAS: Gas = 25_000_000_000_000;
const CALLBACK: Gas = 25_000_000_000_000;
const NO_DEPOSIT: Balance = 0;


type DropId = u64;
type Drops = UnorderedMap<DropId, Drop>;
type WrappedBalance = U128;

#[derive(BorshSerialize, BorshDeserialize, Eq, PartialEq, Debug, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub enum ContactTypes {
    Email,
    Telegram,
    Twitter,
    Github,
    NearGovForum,
}

#[derive(Clone, BorshDeserialize, BorshSerialize, Serialize, Deserialize, Eq, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Contact {
    pub contact_type: ContactTypes,
    pub value: String,
}


#[derive(Clone, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Payout {
    pub amount: WrappedBalance,
    pub contact: Contact,
    pub claimed: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutInput {
    pub amount: WrappedBalance,
    pub contact: Contact,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Drop {
    owner_account_id: AccountId,
    payouts: Vec<Payout>,
    title: String,
    description: String,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct NearDrop {
    drops: Drops,
    near_auth_contract: String,
}


impl Default for NearDrop {
    fn default() -> Self {
        Self {
            near_auth_contract: "".to_string(),
            drops: UnorderedMap::new(b"d".to_vec()),
        }
    }
}

pub fn assert_self() {
    assert_eq!(
        env::predecessor_account_id(),
        env::current_account_id(),
        "Callback can only be called from the contract"
    );
}

fn is_promise_success() -> bool {
    assert_eq!(
        env::promise_results_count(),
        1,
        "Contract expected a result on the callback"
    );
    match env::promise_result(0) {
        PromiseResult::Successful(_) => true,
        _ => false,
    }
}

#[near_bindgen]
impl NearDrop {
    #[init]
    pub fn new(near_auth_contract: String) -> Self {
        assert!(!env::state_exists(), "The contract is already initialized");
        let drop = Self {
            drops: UnorderedMap::new(b"d".to_vec()),
            near_auth_contract,
        };
        drop
    }

    #[payable]
    pub fn add_drop(&mut self, payouts: Vec<PayoutInput>, title: String, description: String) -> u64 {
        let tokens: Balance = near_sdk::env::attached_deposit();

        assert!(tokens >= MIN_DEPOSIT_AMOUNT, "Not enough deposit");
        assert!(payouts.len() < MAX_USERS_SIZE, "Too many users");
        assert!(payouts.len() > 0, "Missing rewards");

        assert!(description.len() < MAX_DESCRIPTION_LENGTH, "Description length is too long");
        assert!(title.len() < MAX_TITLE_LENGTH, "Title length is too long");

        let drop_id = self.drops.len() as u64;
        let owner_id = env::predecessor_account_id();

        let mut total: Balance = 0;
        for payout in &payouts {
            total += payout.amount.0;
        }

        assert!(
            total <= tokens,
            "Not enough attached tokens to provide rewards (Attached: {}. Total rewards: {})",
            tokens, total
        );

        if total < tokens {
            let tokens_to_return = tokens - total;
            env::log(
                format!(
                    "@{} withdrawing extra {}",
                    owner_id, tokens_to_return
                ).as_bytes(),
            );
            Promise::new(owner_id.clone()).transfer(tokens_to_return);
        }

        let payouts_prepared =
            payouts
                .into_iter()
                .map(|payout| {
                    Payout {
                        contact: payout.contact,
                        amount: payout.amount,
                        claimed: false,
                    }
                })
                .collect();

        let d = Drop {
            owner_account_id: owner_id,
            payouts: payouts_prepared,
            title,
            description,
        };
        self.drops.insert(&drop_id, &d);
        drop_id
    }

    pub fn get_claim_amount(&self, drop_id: DropId, contact: Contact) -> WrappedBalance {
        match self.drops.get(&drop_id) {
            Some(drop) => {
                let filtered_payouts: Vec<_> =
                    drop.payouts
                        .into_iter()
                        .filter(|payout| payout.contact == contact && !payout.claimed)
                        .collect();

                let payouts_quantity = filtered_payouts.len();

                if payouts_quantity == 1 {
                    WrappedBalance::from(filtered_payouts[0].amount)
                } else {
                    WrappedBalance::from(0)
                }
            }
            None => WrappedBalance::from(0)
        }
    }

    pub fn claim(&self, drop_id: DropId, contact: Contact) -> PromiseOrValue<bool> {
        let account_id = env::predecessor_account_id();

        let balance_to_claim: Balance = NearDrop::get_claim_amount(self, drop_id.clone(), contact.clone()).0;

        if balance_to_claim > 0 {
            env::log(format!("Claiming {} by @{} [{:?} account {:?}] drop #{}",
                             balance_to_claim, account_id, contact.contact_type, contact.value, drop_id).as_bytes());

            PromiseOrValue::Promise(auth::is_owner(account_id.clone(), contact.clone(), &self.near_auth_contract, NO_DEPOSIT, BASE_GAS)
                .then(ext_self::on_is_owner_on_claim(
                    drop_id,
                    account_id,
                    contact,
                    balance_to_claim,
                    &env::current_account_id(),
                    NO_DEPOSIT,
                    2 * CALLBACK,
                )))
        } else {
            env::log(format!("Claim not found").as_bytes());
            PromiseOrValue::Value(false)
        }
    }

    pub fn on_is_owner_on_claim(&mut self,
                                #[callback] is_owner: bool,
                                drop_id: DropId,
                                recipient_account_id: AccountId,
                                recipient_contact: Contact,
                                balance_to_claim: Balance) -> PromiseOrValue<bool> {
        assert_self();

        if !is_owner {
            env::log(format!("Accounts not found").as_bytes());
            PromiseOrValue::Value(false)
        } else {
            env::log(format!("Claimed {} by @{} [{:?} account {:?}] drop #{}",
                             balance_to_claim, recipient_account_id, recipient_contact.contact_type, recipient_contact.value, drop_id).as_bytes());

            PromiseOrValue::Promise(Promise::new(recipient_account_id.clone())
                .transfer(balance_to_claim)
                .then(ext_self::on_claim_complete(
                    drop_id,
                    recipient_account_id,
                    recipient_contact,
                    balance_to_claim,
                    &env::current_account_id(),
                    0,
                    CALLBACK,
                )))
        }
    }

    pub fn on_claim_complete(&mut self,
                             drop_id: DropId,
                             account_id: AccountId,
                             contact: Contact,
                             balance_to_claim: Balance) -> bool {
        assert_self();

        let transfer_succeeded = is_promise_success();
        if transfer_succeeded {
            match self.drops.get(&drop_id) {
                Some(drop) => {
                    let mut payout_found = false;
                    let payouts_prepared: Vec<_> =
                        drop.payouts
                            .into_iter()
                            .map(|payout| {
                                if payout.contact == contact && payout.amount.0 == balance_to_claim {
                                    payout_found = true;
                                    Payout {
                                        contact: payout.contact,
                                        amount: payout.amount,
                                        claimed: true,
                                    }
                                } else {
                                    payout.clone()
                                }
                            })
                            .collect();

                    if payout_found {
                        env::log(format!("@{} claimed {} [{:?} account {:?}] for drop #{}",
                                         account_id, balance_to_claim, contact.contact_type, contact.value, drop_id).as_bytes());

                        let d = Drop {
                            owner_account_id: drop.owner_account_id,
                            payouts: payouts_prepared,
                            title: drop.title,
                            description: drop.description,
                        };

                        self.drops.insert(&drop_id, &d);
                        true
                    } else {
                        false
                    }
                }
                None => {
                    false
                }
            }
        } else {
            false
        }
    }

    pub fn get_drop(&self, id: u64) -> Option<Drop> {
        match self.drops.get(&id) {
            Some(drop) => Some(drop),
            None => None,
        }
    }

    pub fn get_drops(&self, from_index: u64, limit: u64) -> HashMap<u64, Drop> {
        (from_index..std::cmp::min(from_index + limit, self.drops.len()))
            .map(|index| (index, self.drops.get(&index).unwrap()))
            .collect()
    }

    pub fn get_drops_by_account_id(&self, account_id: AccountId, from_index: u64, limit: u64) -> HashMap<u64, Drop> {
        (from_index..std::cmp::min(from_index + limit, self.drops.len()))
            .filter(|index| self.drops.get(&index).unwrap().owner_account_id == account_id)
            .map(|index| (index, self.drops.get(&index).unwrap()))
            .collect()
    }
}

/*
 * The rest of this file holds the inline tests for the code above
 * Learn more about Rust tests: https://doc.rust-lang.org/book/ch11-01-writing-tests.html
 *
 * To run from contract directory:
 * cargo test -- --nocapture
 *
 * From project root, to run in combination with frontend tests:
 * yarn test
 *
 */
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::MockedBlockchain;
    use near_sdk::{testing_env, VMContext};

    // mock the context for testing, notice "signer_account_id" that was accessed above from env::
    fn get_context(input: Vec<u8>, is_view: bool) -> VMContext {
        VMContext {
            current_account_id: "alice_near".to_string(),
            signer_account_id: "bob_near".to_string(),
            signer_account_pk: vec![0, 1, 2],
            predecessor_account_id: "carol_near".to_string(),
            input,
            block_index: 0,
            block_timestamp: 0,
            account_balance: 0,
            account_locked_balance: 0,
            storage_usage: 0,
            attached_deposit: 0,
            prepaid_gas: 10u64.pow(18),
            random_seed: vec![0, 1, 2],
            is_view,
            output_data_receivers: vec![],
            epoch_height: 19,
        }
    }

    #[test]
    fn set_then_get_greeting() {
        let context = get_context(vec![], false);
        testing_env!(context);
        let mut contract = NearDrop::default();
        contract.set_greeting("howdy".to_string());
        assert_eq!(
            "howdy".to_string(),
            contract.get_greeting("bob_near".to_string())
        );
    }

    #[test]
    fn get_default_greeting() {
        let context = get_context(vec![], true);
        testing_env!(context);
        let contract = NearDrop::default();
        // this test did not call set_greeting so should return the default "Hello" greeting
        assert_eq!(
            "Hello".to_string(),
            contract.get_greeting("francis.near".to_string())
        );
    }
}
