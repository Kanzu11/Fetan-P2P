import { formatUnits, getBytes, encodeBase58, concat, sha256 } from 'ethers';
import type { UserCryptoAddresses } from '@/server/crypto-address-service';

export type DepositNetwork = 'TRC20' | 'BEP20' | 'TON';

export interface VerifiedDepositResult {
  verified: boolean;
  amountUsdt: number;
  confirmations: number;
  fromAddress?: string;
  toAddress: string;
  explorerUrl: string;
}

const BSC_USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TON_USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

const MIN_BSC_CONFIRMATIONS = Math.max(1, Number(process.env.BSC_MIN_CONFIRMATIONS || 6));

function getBscRpcUrls(): string[] {
  const list: string[] = [];
  if (process.env.BSC_RPC_URL) list.push(process.env.BSC_RPC_URL.trim());
  list.push('https://bsc-dataseed.binance.org');
  list.push('https://bsc-dataseed1.defibit.io');
  return list;
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function hex41ToTronBase58(hexOrBase58: string): string {
  const clean = hexOrBase58.trim();
  if (clean.startsWith('T') && clean.length === 34) return clean;
  let hex = clean.replace(/^0x/, '');
  if (hex.length === 40) hex = `41${hex}`;
  if (!/^41[0-9a-fA-F]{40}$/.test(hex)) return clean;
  const payload = getBytes(`0x${hex}`);
  const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
  return encodeBase58(concat([payload, checksum]));
}

interface BscTxReceipt {
  status?: string;
  blockNumber?: string;
  logs?: Array<{ address?: string; topics?: string[]; data?: string }>;
}

async function verifyBep20UsdtDeposit(
  txHash: string,
  expectedAddress: string
): Promise<VerifiedDepositResult> {
  const normalizedHash = txHash.startsWith('0x') ? txHash.toLowerCase() : `0x${txHash.toLowerCase()}`;
  const targetAddress = expectedAddress.toLowerCase();

  let receipt: BscTxReceipt | null = null;
  let latestBlockHex: string | null = null;
  let lastNetworkErr: string | null = null;

  for (const rpcUrl of getBscRpcUrls()) {
    try {
      const [receiptRes, blockRes] = await Promise.all([
        fetchJsonWithTimeout(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [normalizedHash],
          }),
        }),
        fetchJsonWithTimeout(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'eth_blockNumber',
            params: [],
          }),
        }),
      ]);

      const rJson = receiptRes.json as { result?: BscTxReceipt; error?: { message?: string } } | null;
      const bJson = blockRes.json as { result?: string } | null;
      if (receiptRes.ok && rJson && !rJson.error) {
        receipt = rJson.result || null;
        latestBlockHex = bJson?.result || null;
        break;
      }
      lastNetworkErr = rJson?.error?.message || `HTTP ${receiptRes.status}`;
    } catch (err) {
      lastNetworkErr = err instanceof Error ? err.message : 'BSC RPC request failed';
    }
  }

  if (!receipt && lastNetworkErr) {
    throw new Error(`Could not query BSC RPC to verify transaction (${lastNetworkErr}).`);
  }
  if (!receipt) {
    throw new Error('Transaction not found on BNB Smart Chain yet. Please wait for block inclusion.');
  }
  if (receipt.status !== '0x1') {
    throw new Error('This BEP-20 transaction reverted/failed on-chain.');
  }

  const txBlock = receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : 0;
  const latestBlock = latestBlockHex ? parseInt(latestBlockHex, 16) : txBlock;
  const confirmations = Math.max(1, latestBlock - txBlock + 1);
  if (confirmations < MIN_BSC_CONFIRMATIONS) {
    throw new Error(
      `BEP-20 deposit has ${confirmations} confirmation(s). Please wait for at least ${MIN_BSC_CONFIRMATIONS} confirmations.`
    );
  }

  let matchedRaw = 0n;
  let fromAddr: string | undefined;

  for (const log of receipt.logs || []) {
    if (!log.address || log.address.toLowerCase() !== BSC_USDT_CONTRACT) continue;
    if (!log.topics || log.topics.length < 3) continue;
    if (log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;

    const toAddress = `0x${log.topics[2].slice(-40)}`.toLowerCase();
    if (toAddress !== targetAddress) continue;

    fromAddr = `0x${log.topics[1].slice(-40)}`;
    matchedRaw += BigInt(log.data || '0x0');
  }

  if (matchedRaw <= 0n) {
    throw new Error(
      `No BEP-20 USDT transfer to your deposit address (${expectedAddress}) was found in this transaction.`
    );
  }

  const amountUsdt = Math.floor(Number(formatUnits(matchedRaw, 18)) * 1_000_000) / 1_000_000;
  if (!Number.isFinite(amountUsdt) || amountUsdt < 1) {
    throw new Error(`Verified USDT transfer (${amountUsdt}) is below minimum deposit of 1.00 USDT.`);
  }

  return {
    verified: true,
    amountUsdt,
    confirmations,
    fromAddress: fromAddr,
    toAddress: expectedAddress,
    explorerUrl: `https://bscscan.com/tx/${normalizedHash}`,
  };
}

async function verifyTrc20UsdtDeposit(
  txHash: string,
  expectedAddress: string
): Promise<VerifiedDepositResult> {
  const cleanHash = txHash.trim().replace(/^0x/i, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.TRONGRID_API_KEY) {
    headers['TRON-PRO-API-KEY'] = process.env.TRONGRID_API_KEY.trim();
  }

  const [txRes, eventsRes] = await Promise.all([
    fetchJsonWithTimeout(
      `https://api.trongrid.io/walletsolidity/gettransactioninfobyid`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: cleanHash }),
      }
    ),
    fetchJsonWithTimeout(`https://api.trongrid.io/v1/transactions/${cleanHash}/events`, { headers }),
  ]);

  if (!txRes.ok || !eventsRes.ok) {
    throw new Error('Could not reach TronGrid API to verify TRC-20 transaction.');
  }

  const info = txRes.json as { receipt?: { result?: string }; blockNumber?: number } | null;
  if (!info || !info.blockNumber) {
    throw new Error('TRC-20 transaction is not solidified yet. Please wait 30-60 seconds and retry.');
  }
  if (info.receipt?.result && info.receipt.result !== 'SUCCESS') {
    throw new Error(`TRC-20 transaction failed on-chain (${info.receipt.result}).`);
  }

  const eventsBody = eventsRes.json as {
    data?: Array<{
      event_name?: string;
      contract_address?: string;
      result?: { from?: string; to?: string; value?: string };
    }>;
  } | null;

  let matchedUnits = 0n;
  let fromAddr: string | undefined;

  for (const ev of eventsBody?.data || []) {
    if (ev.event_name !== 'Transfer') continue;
    const contractBase58 = ev.contract_address ? hex41ToTronBase58(ev.contract_address) : '';
    if (contractBase58 !== TRON_USDT_CONTRACT) continue;

    const rawTo = ev.result?.to ? hex41ToTronBase58(ev.result.to) : '';
    if (rawTo !== expectedAddress) continue;

    fromAddr = ev.result?.from ? hex41ToTronBase58(ev.result.from) : undefined;
    if (ev.result?.value) {
      matchedUnits += BigInt(ev.result.value);
    }
  }

  if (matchedUnits <= 0n) {
    throw new Error(
      `No TRC-20 USDT transfer to your deposit address (${expectedAddress}) was found in this transaction.`
    );
  }

  const amountUsdt = Math.floor((Number(matchedUnits) / 1_000_000) * 1_000_000) / 1_000_000;
  if (!Number.isFinite(amountUsdt) || amountUsdt < 1) {
    throw new Error(`Verified USDT transfer (${amountUsdt}) is below minimum deposit of 1.00 USDT.`);
  }

  return {
    verified: true,
    amountUsdt,
    confirmations: 20,
    fromAddress: fromAddr,
    toAddress: expectedAddress,
    explorerUrl: `https://tronscan.org/#/transaction/${cleanHash}`,
  };
}

async function verifyTonUsdtDeposit(
  txHash: string,
  expectedTonAddress: string,
  expectedMemo: string
): Promise<VerifiedDepositResult> {
  const cleanHash = txHash.trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.TONCENTER_API_KEY) {
    headers['X-API-Key'] = process.env.TONCENTER_API_KEY.trim();
  }

  const res = await fetchJsonWithTimeout(
    `https://toncenter.com/api/v3/jetton/transfers?transaction_hash=${encodeURIComponent(cleanHash)}`,
    { headers }
  );

  if (!res.ok) {
    throw new Error('Could not reach TonCenter API to verify TON USDT deposit.');
  }

  const body = res.json as {
    jetton_transfers?: Array<{
      amount?: string;
      source?: string;
      destination?: string;
      jetton_master?: string;
      transaction_aborted?: boolean;
      forward_payload?: unknown;
      decoded_forward_payload?: { text?: string };
    }>;
  } | null;

  let matchedUnits = 0n;
  let fromAddr: string | undefined;

  for (const transfer of body?.jetton_transfers || []) {
    if (transfer.transaction_aborted) continue;
    if (transfer.jetton_master && transfer.jetton_master !== TON_USDT_JETTON_MASTER) continue;
    if (transfer.destination !== expectedTonAddress) continue;

    const memoText = transfer.decoded_forward_payload?.text?.trim() || '';
    if (!expectedMemo || memoText !== expectedMemo) continue;

    fromAddr = transfer.source;
    if (transfer.amount) {
      matchedUnits += BigInt(transfer.amount);
    }
  }

  if (matchedUnits <= 0n) {
    throw new Error(
      `No confirmed TON USDT transfer to ${expectedTonAddress} with exact Memo "${expectedMemo}" was found.`
    );
  }

  const amountUsdt = Math.floor((Number(matchedUnits) / 1_000_000) * 1_000_000) / 1_000_000;
  if (!Number.isFinite(amountUsdt) || amountUsdt < 1) {
    throw new Error(`Verified USDT transfer (${amountUsdt}) is below minimum deposit of 1.00 USDT.`);
  }

  return {
    verified: true,
    amountUsdt,
    confirmations: 1,
    fromAddress: fromAddr,
    toAddress: expectedTonAddress,
    explorerUrl: `https://tonviewer.com/transaction/${encodeURIComponent(cleanHash)}`,
  };
}

export async function verifyOnChainUsdtDeposit(params: {
  network: DepositNetwork;
  txHash: string;
  userAddresses?: UserCryptoAddresses;
}): Promise<VerifiedDepositResult> {
  const { network, txHash, userAddresses } = params;

  if (!userAddresses) {
    throw new Error(
      'Deposit wallet derivation (DEPOSIT_XPUB / DEPOSIT_TON_ADDRESS) is not configured on this server yet.'
    );
  }

  switch (network) {
    case 'BEP20':
      return verifyBep20UsdtDeposit(txHash, userAddresses.bep20);
    case 'TRC20':
      return verifyTrc20UsdtDeposit(txHash, userAddresses.trc20);
    case 'TON':
      return verifyTonUsdtDeposit(txHash, userAddresses.ton, userAddresses.tonMemo);
  }
}

