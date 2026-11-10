import { HDNodeWallet, getBytes, sha256, encodeBase58, concat } from 'ethers';

/**
 * Per-user deposit addresses (same model as Binance / OKX / Bybit).
 *
 * - One HD wallet. The server only knows the PUBLIC extended key (xpub),
 *   so a hacked server can see addresses but can never move funds.
 * - Each user gets a fixed child index => a unique, permanent address.
 * - BEP-20 and TRC-20 use the same secp256k1 key, so one child key
 *   gives both a 0x... (BSC) address and a T... (Tron) address.
 * - TON: exchanges use ONE hot wallet + a per-user memo (comment).
 *
 * The private key / seed phrase must live offline (hardware wallet or
 * a separate signing service) and is used only to sweep funds to cold storage.
 */

export interface UserCryptoAddresses {
  trc20: string;
  bep20: string;
  ton: string;
  tonMemo: string;
  derivationIndex: number;
}

/** Stable numeric index for a user id (0 .. 2^31-1). */
export function userIndex(userId: string): number {
  const h = getBytes(sha256(new TextEncoder().encode(userId)));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 1;
}

function evmToTron(evmAddress: string): string {
  const payload = concat(['0x41', evmAddress]);
  const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
  return encodeBase58(concat([payload, checksum]));
}

export function isDepositConfigured(): boolean {
  return Boolean(process.env.DEPOSIT_XPUB && process.env.DEPOSIT_TON_ADDRESS);
}

/**
 * Returns the user's deposit addresses, or null when the platform wallet
 * is not configured (we NEVER show a made-up address).
 */
export function generateUserDepositAddresses(userId: string): UserCryptoAddresses | undefined {
  const xpub = process.env.DEPOSIT_XPUB;
  const tonHot = process.env.DEPOSIT_TON_ADDRESS;
  if (!xpub || !tonHot) return undefined;

  try {
    const index = userIndex(userId);
    // xpub must be exported at account level: m/44'/60'/0'
    const root = HDNodeWallet.fromExtendedKey(xpub);
    const child = root.deriveChild(0).deriveChild(index);
    return {
      bep20: child.address,
      trc20: evmToTron(child.address),
      ton: tonHot,
      tonMemo: `FETAN${index}`,
      derivationIndex: index,
    };
  } catch (err) {
    console.error('Invalid DEPOSIT_XPUB:', err instanceof Error ? err.message : err);
    return undefined;
  }
}
