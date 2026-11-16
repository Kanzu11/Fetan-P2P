import { getAddress, ZeroAddress } from 'ethers';
import { validateCryptoAddress } from '@/server/security/sanitize';
import { generateUserDepositAddresses } from '@/server/crypto-address-service';
import { DEFAULT_USDT_BEP20_CONTRACT } from './constants';

const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';

export interface ValidatedDestination {
  valid: boolean;
  canonicalAddress?: string;
  error?: string;
}

function getBlockedAddresses(userId: string): Set<string> {
  const blocked = new Set<string>([
    ZeroAddress.toLowerCase(),
    BURN_ADDRESS.toLowerCase(),
    DEFAULT_USDT_BEP20_CONTRACT.toLowerCase(),
  ]);

  const envContract = process.env.USDT_BEP20_CONTRACT?.trim();
  if (envContract && /^0x[a-fA-F0-9]{40}$/.test(envContract)) {
    blocked.add(envContract.toLowerCase());
  }

  const hotWallet = process.env.HOT_WALLET_ADDRESS?.trim();
  if (hotWallet && /^0x[a-fA-F0-9]{40}$/.test(hotWallet)) {
    blocked.add(hotWallet.toLowerCase());
  }

  const escrowAddr = process.env.NEXT_PUBLIC_ESCROW_BEP20_ADDRESS?.trim();
  if (escrowAddr && /^0x[a-fA-F0-9]{40}$/.test(escrowAddr)) {
    blocked.add(escrowAddr.toLowerCase());
  }

  const userDeposit = generateUserDepositAddresses(userId);
  if (userDeposit?.bep20 && /^0x[a-fA-F0-9]{40}$/.test(userDeposit.bep20)) {
    blocked.add(userDeposit.bep20.toLowerCase());
  }

  const rawList = process.env.PAYOUT_ADDRESS_BLOCKLIST?.trim();
  if (rawList) {
    for (const entry of rawList.split(',')) {
      const clean = entry.trim().toLowerCase();
      if (clean) blocked.add(clean);
    }
  }

  return blocked;
}

/**
 * Validates and normalizes destination wallet addresses for withdrawals.
 *
 * Mitigates:
 * - EIP-55 checksum corruption causing permanent fund burn on wrong EVM addresses.
 * - Sending payouts into the USDT token contract, zero/burn address, or platform self-addresses.
 * - Known-scam / OFAC blocklisted payout destinations.
 */
export function validatePayoutDestination(
  rawAddress: string,
  network: 'TRC20' | 'BEP20' | 'TON',
  userId: string
): ValidatedDestination {
  const baseCheck = validateCryptoAddress(rawAddress, network);
  if (!baseCheck.valid) {
    return { valid: false, error: baseCheck.error };
  }

  const trimmed = rawAddress.trim();
  if (network !== 'BEP20') {
    const customList = process.env.PAYOUT_ADDRESS_BLOCKLIST?.split(',').map((s) =>
      s.trim().toLowerCase()
    );
    if (customList?.includes(trimmed.toLowerCase())) {
      return { valid: false, error: 'Destination address is blocked by platform compliance rules.' };
    }
    return { valid: true, canonicalAddress: trimmed };
  }

  let checksummed: string;
  try {
    // getAddress enforces EIP-55 mixed-case checksum and rejects mistyped addresses
    checksummed = getAddress(trimmed);
  } catch {
    return {
      valid: false,
      error: 'Invalid BEP-20 address checksum. Double-check every character of the address.',
    };
  }

  const blocked = getBlockedAddresses(userId);
  if (blocked.has(checksummed.toLowerCase())) {
    return {
      valid: false,
      error: 'Withdrawals to platform, contract, zero, or blocked addresses are not permitted.',
    };
  }

  return { valid: true, canonicalAddress: checksummed };
}
