#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

// Source placeholder. Run `anchor keys sync` before the first deployment.
declare_id!("7bmrrLhLHKmB4J4H2VjKfU6kUqUFhsmrxpDuatvrCmJk");

const BPS_SCALE: u128 = 10_000;
const PRICE_SCALE: u128 = 1_000_000;
const MAX_OFFSET_BPS: i16 = 5_000;
const MAX_OFFER_LIFETIME_SECONDS: i64 = 30 * 24 * 60 * 60;
const MAX_FUTURE_MARK_SKEW_SECONDS: i64 = 30;
const MAX_PUBLISH_AGE_SECONDS: i64 = 24 * 60 * 60;
const MAX_SUPPORTED_DECIMALS: u8 = 18;

#[program]
pub mod markdesk {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        publisher: Pubkey,
        max_mark_age_seconds: u32,
    ) -> Result<()> {
        require!(
            publisher != Pubkey::default(),
            MarkDeskError::InvalidPublisher
        );
        require!(
            (10..=3_600).contains(&max_mark_age_seconds),
            MarkDeskError::InvalidMaxMarkAge
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.publisher = publisher;
        config.quote_mint = ctx.accounts.quote_mint.key();
        config.max_mark_age_seconds = max_mark_age_seconds;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        publisher: Pubkey,
        max_mark_age_seconds: u32,
    ) -> Result<()> {
        require!(
            publisher != Pubkey::default(),
            MarkDeskError::InvalidPublisher
        );
        require!(
            (10..=3_600).contains(&max_mark_age_seconds),
            MarkDeskError::InvalidMaxMarkAge
        );

        let config = &mut ctx.accounts.config;
        config.publisher = publisher;
        config.max_mark_age_seconds = max_mark_age_seconds;
        Ok(())
    }

    pub fn publish_mark(
        ctx: Context<PublishMark>,
        price_e6: u64,
        observed_at: i64,
        sequence: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(price_e6 > 0, MarkDeskError::InvalidPrice);
        require!(sequence > 0, MarkDeskError::InvalidSequence);
        require!(
            observed_at <= now.saturating_add(MAX_FUTURE_MARK_SKEW_SECONDS),
            MarkDeskError::MarkFromFuture
        );
        require!(
            now.saturating_sub(observed_at) <= MAX_PUBLISH_AGE_SECONDS,
            MarkDeskError::MarkTooOldToPublish
        );

        let mark = &mut ctx.accounts.mark;
        if mark.mint != Pubkey::default() {
            require!(
                sequence > mark.sequence,
                MarkDeskError::SequenceNotIncreasing
            );
            require_keys_eq!(
                mark.mint,
                ctx.accounts.base_mint.key(),
                MarkDeskError::WrongBaseMint
            );
        }

        mark.mint = ctx.accounts.base_mint.key();
        mark.price_e6 = price_e6;
        mark.observed_at = observed_at;
        mark.sequence = sequence;
        mark.bump = ctx.bumps.mark;

        emit!(MarkPublished {
            mint: mark.mint,
            price_e6,
            observed_at,
            sequence,
        });
        Ok(())
    }

    pub fn create_offer(
        ctx: Context<CreateOffer>,
        offer_id: u64,
        base_amount: u64,
        offset_bps: i16,
        expires_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(base_amount > 0, MarkDeskError::InvalidAmount);
        validate_offset(offset_bps)?;
        require!(expires_at > now, MarkDeskError::InvalidExpiry);
        require!(
            expires_at.saturating_sub(now) <= MAX_OFFER_LIFETIME_SECONDS,
            MarkDeskError::ExpiryTooFar
        );
        assert_mark_fresh(
            &ctx.accounts.mark,
            now,
            ctx.accounts.config.max_mark_age_seconds,
        )?;

        transfer_checked(
            &ctx.accounts.base_token_program,
            &ctx.accounts.maker_base_account,
            &ctx.accounts.base_mint,
            &ctx.accounts.vault,
            &ctx.accounts.maker.to_account_info(),
            base_amount,
            ctx.accounts.base_mint.decimals,
            None,
        )?;

        // V1 fails closed for transfer-fee assets. A later adapter will support
        // explicit gross-up and net-receive terms instead of silently changing size.
        ctx.accounts.vault.reload()?;
        require_eq!(
            ctx.accounts.vault.amount,
            base_amount,
            MarkDeskError::UnsupportedTransferBehavior
        );

        let offer = &mut ctx.accounts.offer;
        offer.maker = ctx.accounts.maker.key();
        offer.base_mint = ctx.accounts.base_mint.key();
        offer.quote_mint = ctx.accounts.config.quote_mint;
        offer.offer_id = offer_id;
        offer.base_amount = base_amount;
        offer.offset_bps = offset_bps;
        offer.created_at = now;
        offer.expires_at = expires_at;
        offer.bump = ctx.bumps.offer;

        emit!(OfferCreated {
            offer: offer.key(),
            maker: offer.maker,
            base_mint: offer.base_mint,
            base_amount,
            offset_bps,
            expires_at,
        });
        Ok(())
    }

    pub fn fill_offer(ctx: Context<FillOffer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let offer = &ctx.accounts.offer;
        require!(now <= offer.expires_at, MarkDeskError::OfferExpired);
        assert_mark_fresh(
            &ctx.accounts.mark,
            now,
            ctx.accounts.config.max_mark_age_seconds,
        )?;

        let quote_amount = calculate_quote_raw(
            offer.base_amount,
            ctx.accounts.base_mint.decimals,
            ctx.accounts.quote_mint.decimals,
            ctx.accounts.mark.price_e6,
            offer.offset_bps,
        )?;

        let maker_quote_before = ctx.accounts.maker_quote_account.amount;
        transfer_checked(
            &ctx.accounts.quote_token_program,
            &ctx.accounts.taker_quote_account,
            &ctx.accounts.quote_mint,
            &ctx.accounts.maker_quote_account,
            &ctx.accounts.taker.to_account_info(),
            quote_amount,
            ctx.accounts.quote_mint.decimals,
            None,
        )?;
        ctx.accounts.maker_quote_account.reload()?;
        let maker_received = ctx
            .accounts
            .maker_quote_account
            .amount
            .checked_sub(maker_quote_before)
            .ok_or(MarkDeskError::ArithmeticOverflow)?;
        require_eq!(
            maker_received,
            quote_amount,
            MarkDeskError::UnsupportedTransferBehavior
        );

        let maker_key = ctx.accounts.maker.key();
        let offer_id_bytes = offer.offer_id.to_le_bytes();
        let bump = [offer.bump];
        let signer_seeds: &[&[u8]] = &[
            b"offer",
            maker_key.as_ref(),
            offer_id_bytes.as_ref(),
            bump.as_ref(),
        ];

        let taker_base_before = ctx.accounts.taker_base_account.amount;
        transfer_checked(
            &ctx.accounts.base_token_program,
            &ctx.accounts.vault,
            &ctx.accounts.base_mint,
            &ctx.accounts.taker_base_account,
            &ctx.accounts.offer.to_account_info(),
            offer.base_amount,
            ctx.accounts.base_mint.decimals,
            Some(signer_seeds),
        )?;
        ctx.accounts.taker_base_account.reload()?;
        let taker_received = ctx
            .accounts
            .taker_base_account
            .amount
            .checked_sub(taker_base_before)
            .ok_or(MarkDeskError::ArithmeticOverflow)?;
        require_eq!(
            taker_received,
            offer.base_amount,
            MarkDeskError::UnsupportedTransferBehavior
        );

        close_token_account(
            &ctx.accounts.base_token_program,
            &ctx.accounts.vault,
            &ctx.accounts.maker.to_account_info(),
            &ctx.accounts.offer.to_account_info(),
            signer_seeds,
        )?;

        emit!(OfferFilled {
            offer: offer.key(),
            maker: offer.maker,
            taker: ctx.accounts.taker.key(),
            base_amount: offer.base_amount,
            quote_amount,
            mark_price_e6: ctx.accounts.mark.price_e6,
            mark_sequence: ctx.accounts.mark.sequence,
        });
        Ok(())
    }

    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        let offer = &ctx.accounts.offer;
        let maker_key = ctx.accounts.maker.key();
        let offer_id_bytes = offer.offer_id.to_le_bytes();
        let bump = [offer.bump];
        let signer_seeds: &[&[u8]] = &[
            b"offer",
            maker_key.as_ref(),
            offer_id_bytes.as_ref(),
            bump.as_ref(),
        ];
        let amount = ctx.accounts.vault.amount;

        transfer_checked(
            &ctx.accounts.base_token_program,
            &ctx.accounts.vault,
            &ctx.accounts.base_mint,
            &ctx.accounts.maker_base_account,
            &ctx.accounts.offer.to_account_info(),
            amount,
            ctx.accounts.base_mint.decimals,
            Some(signer_seeds),
        )?;
        close_token_account(
            &ctx.accounts.base_token_program,
            &ctx.accounts.vault,
            &ctx.accounts.maker.to_account_info(),
            &ctx.accounts.offer.to_account_info(),
            signer_seeds,
        )?;

        emit!(OfferCancelled {
            offer: offer.key(),
            maker: offer.maker,
            returned_amount: amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ MarkDeskError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct PublishMark<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = publisher @ MarkDeskError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = publisher,
        space = 8 + Mark::INIT_SPACE,
        seeds = [b"mark", base_mint.key().as_ref()],
        bump
    )]
    pub mark: Account<'info, Mark>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(offer_id: u64)]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [b"mark", base_mint.key().as_ref()],
        bump = mark.bump,
        constraint = mark.mint == base_mint.key() @ MarkDeskError::WrongBaseMint
    )]
    pub mark: Account<'info, Mark>,
    #[account(
        init,
        payer = maker,
        space = 8 + Offer::INIT_SPACE,
        seeds = [b"offer", maker.key().as_ref(), offer_id.to_le_bytes().as_ref()],
        bump
    )]
    pub offer: Account<'info, Offer>,
    #[account(
        mut,
        token::mint = base_mint,
        token::authority = maker,
        token::token_program = base_token_program
    )]
    pub maker_base_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = maker,
        associated_token::mint = base_mint,
        associated_token::authority = offer,
        associated_token::token_program = base_token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FillOffer<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    /// CHECK: Address is constrained to the maker stored in the offer and only receives lamports.
    #[account(mut, address = offer.maker @ MarkDeskError::WrongMaker)]
    pub maker: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [b"mark", base_mint.key().as_ref()],
        bump = mark.bump,
        constraint = mark.mint == offer.base_mint @ MarkDeskError::WrongBaseMint
    )]
    pub mark: Account<'info, Mark>,
    #[account(
        mut,
        close = maker,
        seeds = [b"offer", offer.maker.as_ref(), offer.offer_id.to_le_bytes().as_ref()],
        bump = offer.bump,
        has_one = base_mint @ MarkDeskError::WrongBaseMint,
        has_one = quote_mint @ MarkDeskError::WrongQuoteMint
    )]
    pub offer: Account<'info, Offer>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    #[account(address = config.quote_mint @ MarkDeskError::WrongQuoteMint)]
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = offer,
        associated_token::token_program = base_token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = base_mint,
        token::authority = taker,
        token::token_program = base_token_program
    )]
    pub taker_base_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = taker,
        token::token_program = quote_token_program
    )]
    pub taker_quote_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = maker,
        token::token_program = quote_token_program
    )]
    pub maker_quote_account: InterfaceAccount<'info, TokenAccount>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(
        mut,
        close = maker,
        seeds = [b"offer", maker.key().as_ref(), offer.offer_id.to_le_bytes().as_ref()],
        bump = offer.bump,
        has_one = maker @ MarkDeskError::Unauthorized,
        has_one = base_mint @ MarkDeskError::WrongBaseMint
    )]
    pub offer: Account<'info, Offer>,
    pub base_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = offer,
        associated_token::token_program = base_token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = base_mint,
        token::authority = maker,
        token::token_program = base_token_program
    )]
    pub maker_base_account: InterfaceAccount<'info, TokenAccount>,
    pub base_token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub publisher: Pubkey,
    pub quote_mint: Pubkey,
    pub max_mark_age_seconds: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Mark {
    pub mint: Pubkey,
    pub price_e6: u64,
    pub observed_at: i64,
    pub sequence: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Offer {
    pub maker: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub offer_id: u64,
    pub base_amount: u64,
    pub offset_bps: i16,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

#[event]
pub struct MarkPublished {
    pub mint: Pubkey,
    pub price_e6: u64,
    pub observed_at: i64,
    pub sequence: u64,
}

#[event]
pub struct OfferCreated {
    pub offer: Pubkey,
    pub maker: Pubkey,
    pub base_mint: Pubkey,
    pub base_amount: u64,
    pub offset_bps: i16,
    pub expires_at: i64,
}

#[event]
pub struct OfferFilled {
    pub offer: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub base_amount: u64,
    pub quote_amount: u64,
    pub mark_price_e6: u64,
    pub mark_sequence: u64,
}

#[event]
pub struct OfferCancelled {
    pub offer: Pubkey,
    pub maker: Pubkey,
    pub returned_amount: u64,
}

fn validate_offset(offset_bps: i16) -> Result<()> {
    require!(
        (-MAX_OFFSET_BPS..=MAX_OFFSET_BPS).contains(&offset_bps),
        MarkDeskError::OffsetOutOfRange
    );
    Ok(())
}

fn assert_mark_fresh(mark: &Mark, now: i64, max_age_seconds: u32) -> Result<()> {
    require!(
        mark.observed_at <= now.saturating_add(MAX_FUTURE_MARK_SKEW_SECONDS),
        MarkDeskError::MarkFromFuture
    );
    require!(
        now.saturating_sub(mark.observed_at) <= i64::from(max_age_seconds),
        MarkDeskError::StaleMark
    );
    Ok(())
}

pub fn calculate_quote_raw(
    base_amount_raw: u64,
    base_decimals: u8,
    quote_decimals: u8,
    mark_price_e6: u64,
    offset_bps: i16,
) -> Result<u64> {
    require!(base_amount_raw > 0, MarkDeskError::InvalidAmount);
    require!(mark_price_e6 > 0, MarkDeskError::InvalidPrice);
    require!(
        base_decimals <= MAX_SUPPORTED_DECIMALS && quote_decimals <= MAX_SUPPORTED_DECIMALS,
        MarkDeskError::UnsupportedDecimals
    );
    validate_offset(offset_bps)?;

    let base_scale = checked_pow10(base_decimals)?;
    let quote_scale = checked_pow10(quote_decimals)?;
    let offset_factor_i32 = 10_000_i32
        .checked_add(i32::from(offset_bps))
        .ok_or(MarkDeskError::ArithmeticOverflow)?;
    let offset_factor =
        u128::try_from(offset_factor_i32).map_err(|_| error!(MarkDeskError::ArithmeticOverflow))?;

    let numerator = u128::from(base_amount_raw)
        .checked_mul(u128::from(mark_price_e6))
        .and_then(|value| value.checked_mul(quote_scale))
        .and_then(|value| value.checked_mul(offset_factor))
        .ok_or(MarkDeskError::ArithmeticOverflow)?;
    let denominator = base_scale
        .checked_mul(PRICE_SCALE)
        .and_then(|value| value.checked_mul(BPS_SCALE))
        .ok_or(MarkDeskError::ArithmeticOverflow)?;

    let rounded = numerator
        .checked_add(
            denominator
                .checked_sub(1)
                .ok_or(MarkDeskError::ArithmeticOverflow)?,
        )
        .and_then(|value| value.checked_div(denominator))
        .ok_or(MarkDeskError::ArithmeticOverflow)?;

    u64::try_from(rounded).map_err(|_| error!(MarkDeskError::QuoteTooLarge))
}

fn checked_pow10(decimals: u8) -> Result<u128> {
    10_u128
        .checked_pow(u32::from(decimals))
        .ok_or_else(|| error!(MarkDeskError::ArithmeticOverflow))
}

#[allow(clippy::too_many_arguments)]
fn transfer_checked<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: Option<&[&[u8]]>,
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    let context = CpiContext::new(token_program.key(), accounts);
    match signer_seeds {
        Some(seeds) => {
            token_interface::transfer_checked(context.with_signer(&[seeds]), amount, decimals)
        }
        None => token_interface::transfer_checked(context, amount, decimals),
    }
}

fn close_token_account<'info>(
    token_program: &Interface<'info, TokenInterface>,
    account: &InterfaceAccount<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let accounts = CloseAccount {
        account: account.to_account_info(),
        destination: destination.clone(),
        authority: authority.clone(),
    };
    token_interface::close_account(
        CpiContext::new(token_program.key(), accounts).with_signer(&[signer_seeds]),
    )
}

#[error_code]
pub enum MarkDeskError {
    #[msg("The publisher public key is invalid")]
    InvalidPublisher,
    #[msg("The maximum mark age is outside the supported range")]
    InvalidMaxMarkAge,
    #[msg("The signer is not authorized")]
    Unauthorized,
    #[msg("The mark price must be positive")]
    InvalidPrice,
    #[msg("The mark sequence must be positive")]
    InvalidSequence,
    #[msg("The mark sequence must strictly increase")]
    SequenceNotIncreasing,
    #[msg("The mark timestamp is too far in the future")]
    MarkFromFuture,
    #[msg("The mark is too old to publish")]
    MarkTooOldToPublish,
    #[msg("The mark is stale")]
    StaleMark,
    #[msg("The amount must be positive")]
    InvalidAmount,
    #[msg("The offset is outside the supported range")]
    OffsetOutOfRange,
    #[msg("The expiry must be in the future")]
    InvalidExpiry,
    #[msg("The expiry is beyond the maximum offer lifetime")]
    ExpiryTooFar,
    #[msg("The offer has expired")]
    OfferExpired,
    #[msg("The base mint does not match the offer")]
    WrongBaseMint,
    #[msg("The quote mint does not match protocol configuration")]
    WrongQuoteMint,
    #[msg("The maker account does not match the offer")]
    WrongMaker,
    #[msg("The mint decimal precision is unsupported")]
    UnsupportedDecimals,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("The calculated quote does not fit in a token amount")]
    QuoteTooLarge,
    #[msg("This token transfer behavior is not supported by v1")]
    UnsupportedTransferBehavior,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_math_matches_typescript_reference() {
        let quote = calculate_quote_raw(250_000, 6, 6, 152_500_000, -300).unwrap();
        assert_eq!(quote, 36_981_250);
    }

    #[test]
    fn quote_math_rounds_up() {
        let quote = calculate_quote_raw(1, 6, 6, 1_000_001, 0).unwrap();
        assert_eq!(quote, 2);
    }

    #[test]
    fn quote_math_rejects_bad_offsets() {
        let error = calculate_quote_raw(1, 0, 6, 1_000_000, -5_001).unwrap_err();
        assert!(error.to_string().contains("offset"));
    }

    #[test]
    fn quote_math_rejects_unsupported_decimals() {
        let error = calculate_quote_raw(1, 19, 6, 1_000_000, 0).unwrap_err();
        assert!(error.to_string().contains("precision"));
    }
}
