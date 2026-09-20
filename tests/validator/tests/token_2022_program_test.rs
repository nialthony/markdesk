use {
    anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas},
    solana_clock::Clock,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_program_test::{ProgramTest, ProgramTestContext},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_system_interface::{instruction as system_instruction, program as system_program},
    solana_transaction::Transaction,
    spl_associated_token_account_interface::{
        address::get_associated_token_address_with_program_id,
        instruction::create_associated_token_account, program as associated_token_program,
    },
    spl_token_2022_interface::{
        extension::{
            default_account_state::instruction as default_account_state_instruction,
            pausable::instruction as pausable_instruction,
            scaled_ui_amount::instruction as scaled_ui_amount_instruction,
            transfer_fee::{
                instruction as transfer_fee_instruction, TransferFeeAmount, TransferFeeConfig,
            },
            transfer_hook::instruction as transfer_hook_instruction,
            BaseStateWithExtensions, ExtensionType, StateWithExtensions,
        },
        instruction as token_instruction,
        state::{Account as SplTokenAccount, AccountState, Mint as SplMint},
    },
};

const BASE_DECIMALS: u8 = 9;
const QUOTE_DECIMALS: u8 = 6;
const TRANSFER_FEE_BPS: u16 = 50;
const GROSS_BASE_AMOUNT: u64 = 1_000_000_000;
const INBOUND_FEE: u64 = 5_000_000;
const ESCROWED_AMOUNT: u64 = 995_000_000;
const OUTBOUND_FEE: u64 = 4_975_000;
const BUYER_NET_AMOUNT: u64 = 990_025_000;
const MARK_PRICE_E6: u64 = 10_000_000;
const QUOTE_AMOUNT: u64 = 9_900_250;
const INITIAL_MAKER_BASE: u64 = 2_000_000_000;
const INITIAL_TAKER_QUOTE: u64 = 100_000_000;
const MARK_SEQUENCE: u64 = 7;
const CREATE_OFFER_COMPUTE_CEILING: u64 = 80_000;
const FILL_OFFER_COMPUTE_CEILING: u64 = 70_000;
const CANCEL_OFFER_COMPUTE_CEILING: u64 = 50_000;

struct TransactionOutcome {
    succeeded: bool,
    error: Option<String>,
    logs: Vec<String>,
    compute_units: u64,
}

#[derive(Debug, PartialEq, Eq)]
struct TokenSnapshot {
    amount: u64,
    withheld_amount: u64,
}

struct Fixture {
    context: ProgramTestContext,
    maker: Keypair,
    taker: Keypair,
    base_mint: Pubkey,
    quote_mint: Pubkey,
    config: Pubkey,
    mark: Pubkey,
    maker_base: Pubkey,
    maker_quote: Pubkey,
    taker_base: Pubkey,
    taker_quote: Pubkey,
}

fn program_test() -> ProgramTest {
    let sbf_out_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/deploy");
    let program = sbf_out_dir.join("markdesk.so");
    assert!(
        program.is_file(),
        "missing {}; run cargo build-sbf before the validator suite",
        program.display()
    );

    // ProgramTest 3.0.7 supplies its matching SBF Token-2022 and associated-token
    // programs; this points it at MarkDesk's separately built SBF artifact.
    std::env::set_var("SBF_OUT_DIR", sbf_out_dir);
    ProgramTest::new("markdesk", markdesk::ID, None)
}

async fn submit(
    context: &mut ProgramTestContext,
    instructions: &[Instruction],
    additional_signers: &[&Keypair],
) -> TransactionOutcome {
    let recent_blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(additional_signers);
    let transaction = Transaction::new_signed_with_payer(
        instructions,
        Some(&context.payer.pubkey()),
        &signers,
        recent_blockhash,
    );
    let processed = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await
        .unwrap();
    let succeeded = processed.result.is_ok();
    let error = processed.result.err().map(|error| format!("{error:?}"));
    let (logs, compute_units) = processed
        .metadata
        .map(|metadata| (metadata.log_messages, metadata.compute_units_consumed))
        .unwrap_or_default();

    TransactionOutcome {
        succeeded,
        error,
        logs,
        compute_units,
    }
}

fn require_success(label: &str, outcome: TransactionOutcome) -> u64 {
    assert!(
        outcome.succeeded,
        "{label} failed: {:?}\n{}",
        outcome.error,
        outcome.logs.join("\n")
    );
    outcome.compute_units
}

fn require_compute_within(label: &str, actual: u64, ceiling: u64) {
    assert!(
        actual <= ceiling,
        "{label} consumed {actual} compute units, above the {ceiling} ceiling"
    );
}

fn require_anchor_failure(label: &str, outcome: TransactionOutcome, error_code: &str) {
    assert!(
        !outcome.succeeded,
        "{label} unexpectedly succeeded ({} compute units)",
        outcome.compute_units
    );
    assert!(
        outcome.logs.iter().any(|line| line.contains(error_code)),
        "{label} did not log {error_code}: {:?}\n{}",
        outcome.error,
        outcome.logs.join("\n")
    );
}

async fn token_snapshot(context: &mut ProgramTestContext, address: Pubkey) -> TokenSnapshot {
    let account = context
        .banks_client
        .get_account(address)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("missing token account {address}"));
    let state = StateWithExtensions::<SplTokenAccount>::unpack(&account.data).unwrap();
    let withheld_amount = state
        .get_extension::<TransferFeeAmount>()
        .map(|extension| u64::from(extension.withheld_amount))
        .unwrap_or(0);
    TokenSnapshot {
        amount: state.base.amount,
        withheld_amount,
    }
}

async fn mint_withheld_amount(context: &mut ProgramTestContext, mint: Pubkey) -> u64 {
    let account = context
        .banks_client
        .get_account(mint)
        .await
        .unwrap()
        .unwrap();
    let state = StateWithExtensions::<SplMint>::unpack(&account.data).unwrap();
    u64::from(
        state
            .get_extension::<TransferFeeConfig>()
            .unwrap()
            .withheld_amount,
    )
}

async fn assert_account_missing(context: &mut ProgramTestContext, label: &str, address: Pubkey) {
    assert!(
        context
            .banks_client
            .get_account(address)
            .await
            .unwrap()
            .is_none(),
        "{label} account {address} still exists"
    );
}

fn markdesk_instruction(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: markdesk::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn create_offer_addresses(maker: Pubkey, base_mint: Pubkey, offer_id: u64) -> (Pubkey, Pubkey) {
    let (offer, _) = Pubkey::find_program_address(
        &[b"offer", maker.as_ref(), &offer_id.to_le_bytes()],
        &markdesk::ID,
    );
    let vault = get_associated_token_address_with_program_id(
        &offer,
        &base_mint,
        &spl_token_2022_interface::ID,
    );
    (offer, vault)
}

fn create_offer_instruction(
    fixture: &Fixture,
    offer_id: u64,
    offer: Pubkey,
    vault: Pubkey,
    minimum_escrowed_amount: u64,
    expires_at: i64,
) -> Instruction {
    markdesk_instruction(
        markdesk::accounts::CreateOffer {
            maker: fixture.maker.pubkey(),
            config: fixture.config,
            base_mint: fixture.base_mint,
            mark: fixture.mark,
            offer,
            maker_base_account: fixture.maker_base,
            vault,
            base_token_program: spl_token_2022_interface::ID,
            associated_token_program: associated_token_program::ID,
            system_program: system_program::ID,
        },
        markdesk::instruction::CreateOffer {
            offer_id,
            gross_base_amount: GROSS_BASE_AMOUNT,
            minimum_escrowed_amount,
            offset_bps: 0,
            expires_at,
        },
    )
}

fn fill_offer_instruction(
    fixture: &Fixture,
    offer: Pubkey,
    vault: Pubkey,
    expected_mark_sequence: u64,
    minimum_buyer_net_amount: u64,
    maximum_quote_amount: u64,
) -> Instruction {
    markdesk_instruction(
        markdesk::accounts::FillOffer {
            taker: fixture.taker.pubkey(),
            maker: fixture.maker.pubkey(),
            config: fixture.config,
            mark: fixture.mark,
            offer,
            base_mint: fixture.base_mint,
            quote_mint: fixture.quote_mint,
            vault,
            taker_base_account: fixture.taker_base,
            taker_quote_account: fixture.taker_quote,
            maker_quote_account: fixture.maker_quote,
            base_token_program: spl_token_2022_interface::ID,
            quote_token_program: spl_token_2022_interface::ID,
        },
        markdesk::instruction::FillOffer {
            expected_mark_sequence,
            minimum_buyer_net_amount,
            maximum_quote_amount,
        },
    )
}

fn cancel_offer_instruction(
    fixture: &Fixture,
    offer: Pubkey,
    vault: Pubkey,
    minimum_return_amount: u64,
) -> Instruction {
    markdesk_instruction(
        markdesk::accounts::CancelOffer {
            maker: fixture.maker.pubkey(),
            offer,
            base_mint: fixture.base_mint,
            vault,
            maker_base_account: fixture.maker_base,
            base_token_program: spl_token_2022_interface::ID,
        },
        markdesk::instruction::CancelOffer {
            minimum_return_amount,
        },
    )
}

async fn setup_fixture() -> Fixture {
    let mut context = program_test().start_with_context().await;
    // Fixed test-only secrets keep PDA bump-search compute deterministic.
    let issuer = Keypair::new_from_array([1; 32]);
    let publisher = Keypair::new_from_array([2; 32]);
    let maker = Keypair::new_from_array([3; 32]);
    let taker = Keypair::new_from_array([4; 32]);
    let base_mint_keypair = Keypair::new_from_array([5; 32]);
    let quote_mint_keypair = Keypair::new_from_array([6; 32]);
    let base_mint = base_mint_keypair.pubkey();
    let quote_mint = quote_mint_keypair.pubkey();

    let funding = [
        system_instruction::transfer(&context.payer.pubkey(), &issuer.pubkey(), 1_000_000_000),
        system_instruction::transfer(&context.payer.pubkey(), &publisher.pubkey(), 1_000_000_000),
        system_instruction::transfer(&context.payer.pubkey(), &maker.pubkey(), 1_000_000_000),
        system_instruction::transfer(&context.payer.pubkey(), &taker.pubkey(), 1_000_000_000),
    ];
    require_success("fund actors", submit(&mut context, &funding, &[]).await);

    let rent = context.banks_client.get_rent().await.unwrap();
    let base_extensions = [
        ExtensionType::TransferFeeConfig,
        ExtensionType::DefaultAccountState,
        ExtensionType::PermanentDelegate,
        ExtensionType::TransferHook,
        ExtensionType::Pausable,
        ExtensionType::ScaledUiAmount,
    ];
    let base_mint_len =
        ExtensionType::try_calculate_account_len::<SplMint>(&base_extensions).unwrap();
    let base_mint_instructions = [
        system_instruction::create_account(
            &context.payer.pubkey(),
            &base_mint,
            rent.minimum_balance(base_mint_len),
            base_mint_len as u64,
            &spl_token_2022_interface::ID,
        ),
        transfer_fee_instruction::initialize_transfer_fee_config(
            &spl_token_2022_interface::ID,
            &base_mint,
            Some(&issuer.pubkey()),
            Some(&issuer.pubkey()),
            TRANSFER_FEE_BPS,
            u64::MAX,
        )
        .unwrap(),
        default_account_state_instruction::initialize_default_account_state(
            &spl_token_2022_interface::ID,
            &base_mint,
            &AccountState::Initialized,
        )
        .unwrap(),
        token_instruction::initialize_permanent_delegate(
            &spl_token_2022_interface::ID,
            &base_mint,
            &issuer.pubkey(),
        )
        .unwrap(),
        transfer_hook_instruction::initialize(
            &spl_token_2022_interface::ID,
            &base_mint,
            Some(issuer.pubkey()),
            None,
        )
        .unwrap(),
        pausable_instruction::initialize(
            &spl_token_2022_interface::ID,
            &base_mint,
            &issuer.pubkey(),
        )
        .unwrap(),
        scaled_ui_amount_instruction::initialize(
            &spl_token_2022_interface::ID,
            &base_mint,
            Some(issuer.pubkey()),
            1.0,
        )
        .unwrap(),
        token_instruction::initialize_mint2(
            &spl_token_2022_interface::ID,
            &base_mint,
            &issuer.pubkey(),
            Some(&issuer.pubkey()),
            BASE_DECIMALS,
        )
        .unwrap(),
    ];
    require_success(
        "initialize extension-enabled base mint",
        submit(&mut context, &base_mint_instructions, &[&base_mint_keypair]).await,
    );

    let quote_mint_len = ExtensionType::try_calculate_account_len::<SplMint>(&[]).unwrap();
    let quote_mint_instructions = [
        system_instruction::create_account(
            &context.payer.pubkey(),
            &quote_mint,
            rent.minimum_balance(quote_mint_len),
            quote_mint_len as u64,
            &spl_token_2022_interface::ID,
        ),
        token_instruction::initialize_mint2(
            &spl_token_2022_interface::ID,
            &quote_mint,
            &issuer.pubkey(),
            None,
            QUOTE_DECIMALS,
        )
        .unwrap(),
    ];
    require_success(
        "initialize quote mint",
        submit(
            &mut context,
            &quote_mint_instructions,
            &[&quote_mint_keypair],
        )
        .await,
    );

    let maker_base = get_associated_token_address_with_program_id(
        &maker.pubkey(),
        &base_mint,
        &spl_token_2022_interface::ID,
    );
    let maker_quote = get_associated_token_address_with_program_id(
        &maker.pubkey(),
        &quote_mint,
        &spl_token_2022_interface::ID,
    );
    let taker_base = get_associated_token_address_with_program_id(
        &taker.pubkey(),
        &base_mint,
        &spl_token_2022_interface::ID,
    );
    let taker_quote = get_associated_token_address_with_program_id(
        &taker.pubkey(),
        &quote_mint,
        &spl_token_2022_interface::ID,
    );
    let create_user_accounts = [
        create_associated_token_account(
            &context.payer.pubkey(),
            &maker.pubkey(),
            &base_mint,
            &spl_token_2022_interface::ID,
        ),
        create_associated_token_account(
            &context.payer.pubkey(),
            &maker.pubkey(),
            &quote_mint,
            &spl_token_2022_interface::ID,
        ),
        create_associated_token_account(
            &context.payer.pubkey(),
            &taker.pubkey(),
            &base_mint,
            &spl_token_2022_interface::ID,
        ),
        create_associated_token_account(
            &context.payer.pubkey(),
            &taker.pubkey(),
            &quote_mint,
            &spl_token_2022_interface::ID,
        ),
    ];
    require_success(
        "create user token accounts",
        submit(&mut context, &create_user_accounts, &[]).await,
    );

    let mint_balances = [
        token_instruction::mint_to_checked(
            &spl_token_2022_interface::ID,
            &base_mint,
            &maker_base,
            &issuer.pubkey(),
            &[],
            INITIAL_MAKER_BASE,
            BASE_DECIMALS,
        )
        .unwrap(),
        token_instruction::mint_to_checked(
            &spl_token_2022_interface::ID,
            &quote_mint,
            &taker_quote,
            &issuer.pubkey(),
            &[],
            INITIAL_TAKER_QUOTE,
            QUOTE_DECIMALS,
        )
        .unwrap(),
    ];
    require_success(
        "mint test balances",
        submit(&mut context, &mint_balances, &[&issuer]).await,
    );

    let (config, _) = Pubkey::find_program_address(&[b"config"], &markdesk::ID);
    let initialize_config = markdesk_instruction(
        markdesk::accounts::InitializeConfig {
            authority: context.payer.pubkey(),
            config,
            quote_mint,
            system_program: system_program::ID,
        },
        markdesk::instruction::InitializeConfig {
            publisher: publisher.pubkey(),
            max_mark_age_seconds: 3_600,
        },
    );
    require_success(
        "initialize MarkDesk config",
        submit(&mut context, &[initialize_config], &[]).await,
    );

    let (mark, _) = Pubkey::find_program_address(&[b"mark", base_mint.as_ref()], &markdesk::ID);
    let clock: Clock = context.banks_client.get_sysvar().await.unwrap();
    let publish_mark = markdesk_instruction(
        markdesk::accounts::PublishMark {
            publisher: publisher.pubkey(),
            config,
            base_mint,
            mark,
            system_program: system_program::ID,
        },
        markdesk::instruction::PublishMark {
            price_e6: MARK_PRICE_E6,
            observed_at: clock.unix_timestamp,
            sequence: MARK_SEQUENCE,
        },
    );
    require_success(
        "publish fresh mark",
        submit(&mut context, &[publish_mark], &[&publisher]).await,
    );

    Fixture {
        context,
        maker,
        taker,
        base_mint,
        quote_mint,
        config,
        mark,
        maker_base,
        maker_quote,
        taker_base,
        taker_quote,
    }
}

#[tokio::test]
async fn create_fill_enforces_signed_bounds_and_settles_token_2022_fees() {
    let mut fixture = setup_fixture().await;
    let offer_id = 41;
    let (offer, vault) =
        create_offer_addresses(fixture.maker.pubkey(), fixture.base_mint, offer_id);
    let clock: Clock = fixture.context.banks_client.get_sysvar().await.unwrap();
    let expires_at = clock.unix_timestamp + 3_600;

    let invalid_create = create_offer_instruction(
        &fixture,
        offer_id,
        offer,
        vault,
        ESCROWED_AMOUNT + 1,
        expires_at,
    );
    let outcome = submit(&mut fixture.context, &[invalid_create], &[&fixture.maker]).await;
    require_anchor_failure(
        "create minimum escrow bound",
        outcome,
        "MinimumEscrowNotMet",
    );
    assert_account_missing(&mut fixture.context, "rolled-back offer", offer).await;
    assert_account_missing(&mut fixture.context, "rolled-back vault", vault).await;
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.maker_base).await,
        TokenSnapshot {
            amount: INITIAL_MAKER_BASE,
            withheld_amount: 0,
        }
    );

    let create = create_offer_instruction(
        &fixture,
        offer_id,
        offer,
        vault,
        ESCROWED_AMOUNT,
        expires_at,
    );
    let create_units = require_success(
        "create fee-aware offer",
        submit(&mut fixture.context, &[create], &[&fixture.maker]).await,
    );

    let offer_account = fixture
        .context
        .banks_client
        .get_account(offer)
        .await
        .unwrap()
        .unwrap();
    let mut offer_data = offer_account.data.as_slice();
    let offer_state = markdesk::Offer::try_deserialize(&mut offer_data).unwrap();
    assert_eq!(offer_state.base_amount, ESCROWED_AMOUNT);
    assert_eq!(
        token_snapshot(&mut fixture.context, vault).await,
        TokenSnapshot {
            amount: ESCROWED_AMOUNT,
            withheld_amount: INBOUND_FEE,
        }
    );

    let wrong_sequence = fill_offer_instruction(
        &fixture,
        offer,
        vault,
        MARK_SEQUENCE + 1,
        BUYER_NET_AMOUNT,
        QUOTE_AMOUNT,
    );
    let outcome = submit(&mut fixture.context, &[wrong_sequence], &[&fixture.taker]).await;
    require_anchor_failure(
        "fill mark sequence bound",
        outcome,
        "UnexpectedMarkSequence",
    );

    let excessive_buyer_minimum = fill_offer_instruction(
        &fixture,
        offer,
        vault,
        MARK_SEQUENCE,
        BUYER_NET_AMOUNT + 1,
        QUOTE_AMOUNT,
    );
    let outcome = submit(
        &mut fixture.context,
        &[excessive_buyer_minimum],
        &[&fixture.taker],
    )
    .await;
    require_anchor_failure("fill buyer net bound", outcome, "MinimumBuyerNetNotMet");

    let insufficient_quote_maximum = fill_offer_instruction(
        &fixture,
        offer,
        vault,
        MARK_SEQUENCE,
        BUYER_NET_AMOUNT,
        QUOTE_AMOUNT - 1,
    );
    let outcome = submit(
        &mut fixture.context,
        &[insufficient_quote_maximum],
        &[&fixture.taker],
    )
    .await;
    require_anchor_failure("fill quote maximum bound", outcome, "MaximumQuoteExceeded");
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.taker_base).await,
        TokenSnapshot {
            amount: 0,
            withheld_amount: 0,
        }
    );
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.maker_quote).await,
        TokenSnapshot {
            amount: 0,
            withheld_amount: 0,
        }
    );
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.taker_quote).await,
        TokenSnapshot {
            amount: INITIAL_TAKER_QUOTE,
            withheld_amount: 0,
        }
    );
    assert_eq!(
        token_snapshot(&mut fixture.context, vault).await,
        TokenSnapshot {
            amount: ESCROWED_AMOUNT,
            withheld_amount: INBOUND_FEE,
        }
    );

    let fill = fill_offer_instruction(
        &fixture,
        offer,
        vault,
        MARK_SEQUENCE,
        BUYER_NET_AMOUNT,
        QUOTE_AMOUNT,
    );
    let fill_units = require_success(
        "fill fee-aware offer",
        submit(&mut fixture.context, &[fill], &[&fixture.taker]).await,
    );

    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.taker_base).await,
        TokenSnapshot {
            amount: BUYER_NET_AMOUNT,
            withheld_amount: OUTBOUND_FEE,
        }
    );
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.maker_quote).await,
        TokenSnapshot {
            amount: QUOTE_AMOUNT,
            withheld_amount: 0,
        }
    );
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.taker_quote).await,
        TokenSnapshot {
            amount: INITIAL_TAKER_QUOTE - QUOTE_AMOUNT,
            withheld_amount: 0,
        }
    );
    assert_eq!(
        mint_withheld_amount(&mut fixture.context, fixture.base_mint).await,
        INBOUND_FEE
    );
    assert_account_missing(&mut fixture.context, "filled vault", vault).await;
    assert_account_missing(&mut fixture.context, "filled offer", offer).await;
    require_compute_within("create_offer", create_units, CREATE_OFFER_COMPUTE_CEILING);
    require_compute_within("fill_offer", fill_units, FILL_OFFER_COMPUTE_CEILING);

    println!("markdesk SBF compute units: create_offer={create_units}, fill_offer={fill_units}");
}

#[tokio::test]
async fn create_cancel_enforces_return_bound_harvests_and_closes() {
    let mut fixture = setup_fixture().await;
    let offer_id = 42;
    let (offer, vault) =
        create_offer_addresses(fixture.maker.pubkey(), fixture.base_mint, offer_id);
    let clock: Clock = fixture.context.banks_client.get_sysvar().await.unwrap();
    let expires_at = clock.unix_timestamp + 3_600;
    let create = create_offer_instruction(
        &fixture,
        offer_id,
        offer,
        vault,
        ESCROWED_AMOUNT,
        expires_at,
    );
    require_success(
        "create cancellable offer",
        submit(&mut fixture.context, &[create], &[&fixture.maker]).await,
    );

    let invalid_cancel = cancel_offer_instruction(&fixture, offer, vault, BUYER_NET_AMOUNT + 1);
    let outcome = submit(&mut fixture.context, &[invalid_cancel], &[&fixture.maker]).await;
    require_anchor_failure("cancel return bound", outcome, "MinimumReturnNotMet");
    assert_eq!(
        token_snapshot(&mut fixture.context, vault).await,
        TokenSnapshot {
            amount: ESCROWED_AMOUNT,
            withheld_amount: INBOUND_FEE,
        }
    );
    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.maker_base).await,
        TokenSnapshot {
            amount: INITIAL_MAKER_BASE - GROSS_BASE_AMOUNT,
            withheld_amount: 0,
        }
    );

    let cancel = cancel_offer_instruction(&fixture, offer, vault, BUYER_NET_AMOUNT);
    let cancel_units = require_success(
        "cancel fee-aware offer",
        submit(&mut fixture.context, &[cancel], &[&fixture.maker]).await,
    );

    assert_eq!(
        token_snapshot(&mut fixture.context, fixture.maker_base).await,
        TokenSnapshot {
            amount: INITIAL_MAKER_BASE - GROSS_BASE_AMOUNT + BUYER_NET_AMOUNT,
            withheld_amount: OUTBOUND_FEE,
        }
    );
    assert_eq!(
        mint_withheld_amount(&mut fixture.context, fixture.base_mint).await,
        INBOUND_FEE
    );
    assert_account_missing(&mut fixture.context, "cancelled vault", vault).await;
    assert_account_missing(&mut fixture.context, "cancelled offer", offer).await;
    require_compute_within("cancel_offer", cancel_units, CANCEL_OFFER_COMPUTE_CEILING);

    println!("markdesk SBF compute units: cancel_offer={cancel_units}");
}
