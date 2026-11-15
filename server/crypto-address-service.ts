import { HDNodeWallet, type HDNodeVoidWallet, getBytes, sha256, encodeBase58, concat } from 'ethers';

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

export type DepositNetwork = 'TRC20' | 'BEP20' | 'TON';

let cachedXpubValue = '';
let cachedRootNode: HDNodeWallet | HDNodeVoidWallet | null = null;
const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.error(message);
}

/** Strips surrounding whitespace and accidental quotes, and ignores .env.example placeholders. */
export function cleanDepositEnvValue(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let val = raw.trim();
  if (
    val.length >= 2 &&
    ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
  ) {
    val = val.slice(1, -1).trim();
  }
  if (!val || val.includes('...') || /your_/i.test(val)) return '';
  return val;
}

function crc16Ccitt(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Normalizes a TON address (friendly EQ/UQ or raw workchain:hash) into canonical
 * raw `<workchain>:<64-hex>` form, validating base64url CRC16 checksums.
 */
export function normalizeTonAddressToRaw(addr?: string | null): string | null {
  const clean = cleanDepositEnvValue(addr);
  if (!clean) return null;

  const rawMatch = /^(-?\d+):([0-9a-fA-F]{64})$/.exec(clean);
  if (rawMatch) {
    return `${rawMatch[1]}:${rawMatch[2].toLowerCase()}`;
  }

  if (!/^[A-Za-z0-9+/_-]{48}$/.test(clean)) return null;
  const buf = Buffer.from(clean.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length !== 36) return null;

  const tag = buf[0];
  if ((tag & 0x3f) !== 0x11) return null;
  if (crc16Ccitt(buf.subarray(0, 34)) !== buf.readUInt16BE(34)) return null;

  const workchain = buf.readInt8(1);
  return `${workchain}:${buf.subarray(2, 34).toString('hex').toLowerCase()}`;
}

function getValidXpubRoot(): HDNodeWallet | HDNodeVoidWallet | null {
  const xpub = cleanDepositEnvValue(process.env.DEPOSIT_XPUB);
  if (!xpub) return null;

  if (cachedXpubValue === xpub && cachedRootNode) {
    return cachedRootNode;
  }

  const lowerPrefix = xpub.slice(0, 4).toLowerCase();
  if (lowerPrefix === 'zpub' || lowerPrefix === 'ypub' || lowerPrefix === 'vpub' || lowerPrefix === 'upub') {
    warnOnce(
      `xpub:${xpub}`,
      `Invalid DEPOSIT_XPUB: starts with "${xpub.slice(0, 4)}" (Bitcoin SegWit extended key). Fetan P2P requires a standard BIP44 EVM "xpub..." exported at m/44'/60'/0'.`
    );
    return null;
  }
  if (lowerPrefix.endsWith('prv')) {
    warnOnce(
      `xpub:${xpub}`,
      'Invalid DEPOSIT_XPUB: detected an extended PRIVATE key. Never place private keys on the server — use a public "xpub...".'
    );
    return null;
  }

  try {
    const root = HDNodeWallet.fromExtendedKey(xpub);
    cachedXpubValue = xpub;
    cachedRootNode = root;
    return root;
  } catch (err) {
    warnOnce(
      `xpub:${xpub}`,
      `Invalid DEPOSIT_XPUB: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function getValidTonHotAddress(): string {
  const tonHot = cleanDepositEnvValue(process.env.DEPOSIT_TON_ADDRESS);
  if (!tonHot) return '';
  if (!normalizeTonAddressToRaw(tonHot)) {
    warnOnce(
      `ton:${tonHot}`,
      'Invalid DEPOSIT_TON_ADDRESS: expected a valid TON wallet address (EQ.../UQ... or workchain:hash).'
    );
    return '';
  }
  return tonHot;
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

export function isDepositConfigured(network?: DepositNetwork): boolean {
  if (network === 'TON') return Boolean(getValidTonHotAddress());
  if (network === 'BEP20' || network === 'TRC20') return Boolean(getValidXpubRoot());
  return Boolean(getValidXpubRoot() || getValidTonHotAddress());
}

/**
 * Returns the user's configured deposit addresses, or undefined when neither
 * DEPOSIT_XPUB nor DEPOSIT_TON_ADDRESS is validly configured.
 */
export function generateUserDepositAddresses(userId: string): UserCryptoAddresses | undefined {
  const root = getValidXpubRoot();
  const tonHot = getValidTonHotAddress();
  if (!root && !tonHot) return undefined;

  const index = userIndex(userId);
  let bep20 = '';
  let trc20 = '';

  if (root) {
    // xpub must be exported at account level: m/44'/60'/0'
    const child = root.deriveChild(0).deriveChild(index);
    bep20 = child.address;
    trc20 = evmToTron(child.address);
  }

  return {
    bep20,
    trc20,
    ton: tonHot,
    tonMemo: tonHot ? `FETAN${index}` : '',
    derivationIndex: index,
  };
}

/**
 * Combines stored DB depositAddresses with current server-derived addresses so
 * existing users automatically receive newly configured or fixed network addresses.
 */
export function resolveUserDepositAddresses(
  userId: string,
  stored?: Partial<UserCryptoAddresses> | null
): UserCryptoAddresses | undefined {
  const live = generateUserDepositAddresses(userId);
  const hasStored = Boolean(stored && (stored.bep20 || stored.trc20 || stored.ton));

  if (!live) {
    if (!hasStored || !stored) return undefined;
    return {
      trc20: stored.trc20 || '',
      bep20: stored.bep20 || '',
      ton: stored.ton || '',
      tonMemo: stored.tonMemo || '',
      derivationIndex: stored.derivationIndex ?? userIndex(userId),
    };
  }

  return {
    trc20: live.trc20 || stored?.trc20 || '',
    bep20: live.bep20 || stored?.bep20 || '',
    ton: live.ton || stored?.ton || '',
    tonMemo: live.tonMemo || stored?.tonMemo || '',
    derivationIndex: live.derivationIndex,
  };
}

export function depositAddressesEqual(
  a?: Partial<UserCryptoAddresses> | null,
  b?: Partial<UserCryptoAddresses> | null
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.trc20 || '') === (b.trc20 || '') &&
    (a.bep20 || '') === (b.bep20 || '') &&
    (a.ton || '') === (b.ton || '') &&
    (a.tonMemo || '') === (b.tonMemo || '') &&
    a.derivationIndex === b.derivationIndex
  );
}
