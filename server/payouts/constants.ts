import { Prisma } from '@prisma/client';

/**
 * Network, token, and risk limit constants for automated BEP-20 payouts.
 * Never store private keys or secret material in this module.
 */
export const BSC_MAINNET_CHAIN_ID = 56;
export const BSC_TESTNET_CHAIN_ID = 97;

export const DEFAULT_USDT_BEP20_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
export const USDT_BEP20_DECIMALS = 18;

// keccak256("Transfer(address,address,uint256)")
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const DEFAULT_BSC_FALLBACK_RPCS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-rpc.publicnode.com',
  'https://bsc.drpc.org',
] as const;

/**
 * Hardcoded velocity & single-tx auto-approval limits.
 * Keeping these in code prevents compromised env dashboards from raising limits.
 */
export const MAX_AUTO_TX_USDT = new Prisma.Decimal('100');
export const MAX_AUTO_24H_USDT = new Prisma.Decimal('500');
export const MIN_ACCOUNT_AGE_FOR_AUTO_MS = 24 * 60 * 60 * 1000;
export const MIN_WITHDRAWAL_USDT = new Prisma.Decimal('5');
export const MAX_WITHDRAWAL_USDT = new Prisma.Decimal('100000');
