/**
 * Input sanitization, format validators, and boundary guards for Fetan P2P.
 * Protects against XSS, injection, address spoofing, and invalid transaction payloads.
 */

export function sanitizeString(input: unknown, maxLength: number = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>'"&]/g, (char) => {
      switch (char) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#x27;';
        case '&':
          return '&amp;';
        default:
          return char;
      }
    })
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates crypto destination wallet addresses according to network specs.
 */
export function validateCryptoAddress(
  address: string,
  network: 'TRC20' | 'BEP20' | 'TON' | string
): { valid: boolean; error?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Recipient wallet address is required.' };
  }

  const clean = address.trim();

  switch (network.toUpperCase()) {
    case 'TRC20':
    case 'TRON':
      // Tron base58 address: 34 characters starting with 'T'
      if (!/^T[1-9A-HJ-NP-za-km-z]{33}$/.test(clean)) {
        return {
          valid: false,
          error: 'Invalid TRC-20 address. Tron addresses must start with "T" and be exactly 34 Base58 characters.',
        };
      }
      return { valid: true };

    case 'BEP20':
    case 'BSC':
    case 'ERC20':
      // EVM hex address: 0x followed by 40 hex characters
      if (!/^0x[a-fA-F0-9]{40}$/.test(clean)) {
        return {
          valid: false,
          error: 'Invalid BEP-20 address. Binance Smart Chain addresses must start with "0x" and contain 40 hexadecimal characters.',
        };
      }
      return { valid: true };

    case 'TON':
      // TON address: either user-friendly (48 chars base64url starting with EQ or UQ) or raw (0:... or -1:...)
      if (
        !/^[EUQ][0-9A-Za-z_-]{47}$/.test(clean) &&
        !/^(-1|0):[0-9a-fA-F]{64}$/.test(clean)
      ) {
        return {
          valid: false,
          error: 'Invalid TON address. Must be a valid 48-character user-friendly address (starts with EQ/UQ) or raw format.',
        };
      }
      return { valid: true };

    default:
      if (clean.length < 24 || clean.length > 100) {
        return { valid: false, error: 'Wallet address length is outside normal range (24-100 characters).' };
      }
      return { valid: true };
  }
}

/**
 * Validates blockchain transaction hashes (TxID).
 */
export function validateTxHash(
  txHash: string,
  network?: string
): { valid: boolean; error?: string } {
  if (!txHash || typeof txHash !== 'string') {
    return { valid: false, error: 'Transaction hash (TxID) is required.' };
  }

  const clean = txHash.trim();

  // EVM hashes: 0x + 64 hex (66 chars)
  // Tron hashes: 64 hex chars
  // TON hashes: 64 hex chars or base64
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(clean) && !/^[A-Za-z0-9+/=_-]{43,88}$/.test(clean)) {
    return {
      valid: false,
      error: 'Invalid transaction hash format. Must be a standard 64-character hexadecimal or base64 hash.',
    };
  }

  return { valid: true };
}

/**
 * Validates and sanitizes a numerical amount (USDT, ETB, etc.).
 */
export function sanitizeAmount(
  value: unknown,
  min: number = 1,
  max: number = 1_000_000
): { valid: boolean; amount: number; error?: string } {
  const num = typeof value === 'number' ? value : parseFloat(String(value));

  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, amount: 0, error: 'Amount must be a valid number.' };
  }

  if (num < min) {
    return { valid: false, amount: num, error: `Minimum amount is ${min}.` };
  }

  if (num > max) {
    return { valid: false, amount: num, error: `Maximum amount cannot exceed ${max.toLocaleString()}.` };
  }

  // Round to 2 decimal places to prevent floating point exploit
  const rounded = Math.round(num * 100) / 100;
  return { valid: true, amount: rounded };
}

