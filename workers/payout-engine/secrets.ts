import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { getAddress, TransactionRequest, Wallet } from 'ethers';

export interface WorkerSigner {
  readonly address: string;
  signTransaction(tx: TransactionRequest): Promise<string>;
}

const KEY_HEX_REGEX = /^(0x)?([0-9a-fA-F]{64})$/;

async function fetchImds(path: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`http://169.254.169.254/opc/v2/identity${path}`, {
      headers: { Authorization: 'Bearer Oracle' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OCI IMDSv2 ${path} returned HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function getCertFingerprint(pem: string): string {
  const x509 = new crypto.X509Certificate(pem);
  return x509.fingerprint.toLowerCase(); // SHA-1 colon-separated fingerprint expected by OCI fed-x509
}

function extractTenancyOcidFromCert(pem: string): string {
  const x509 = new crypto.X509Certificate(pem);
  const match = /opc-tenant:([^,\n/]+)/.exec(x509.subject);
  if (!match?.[1]) {
    throw new Error('Could not parse opc-tenant OCID from OCI Instance Principal certificate.');
  }
  return match[1].trim();
}

/**
 * Fetches hot wallet key from OCI Vault using Instance Principal IMDSv2 + RSA-SHA256 HTTP Signature.
 * Zero OCI API key files touch the VM filesystem.
 */
async function readSecretFromOciVault(): Promise<string> {
  const secretOcid = process.env.OCI_VAULT_SECRET_OCID?.trim();
  const region = process.env.OCI_REGION?.trim();
  if (!secretOcid || !region) {
    throw new Error('OCI Vault mode requires OCI_VAULT_SECRET_OCID and OCI_REGION.');
  }

  const [leafCertPem, leafKeyPem] = await Promise.all([
    fetchImds('/cert.pem'),
    fetchImds('/key.pem'),
  ]);

  const tenancyOcid = extractTenancyOcidFromCert(leafCertPem);
  const fingerprint = getCertFingerprint(leafCertPem);
  const keyId = `fed-x509:${tenancyOcid}/${fingerprint}`;

  const host = `secrets.vaults.${region}.oci.oraclecloud.com`;
  const targetPath = `/20190301/secretbundles/${encodeURIComponent(secretOcid)}`;
  const dateHeader = new Date().toUTCString();

  const signingString = [
    `(request-target): get ${targetPath}`,
    `date: ${dateHeader}`,
    `host: ${host}`,
  ].join('\n');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingString);
  const signatureB64 = signer.sign(leafKeyPem, 'base64');

  const authHeader =
    `Signature version="1",headers="(request-target) date host",keyId="${keyId}",algorithm="rsa-sha256",signature="${signatureB64}"`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://${host}${targetPath}`, {
      method: 'GET',
      headers: {
        Date: dateHeader,
        Host: host,
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OCI Vault returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      secretBundleContent?: { contentType?: string; content?: string };
    };
    const b64 = body?.secretBundleContent?.content;
    if (!b64) throw new Error('OCI Vault bundle contained no secret content.');
    return Buffer.from(b64, 'base64').toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads hot wallet key from a strict chmod 0600 file or systemd $CREDENTIALS_DIRECTORY/hot_wallet_key.
 *
 * Mitigates:
 * - Other local system accounts or compromised sibling services reading a world/group-readable key file.
 */
async function readSecretFromLockedFile(): Promise<string> {
  const credDir = process.env.CREDENTIALS_DIRECTORY?.trim();
  const keyPath = credDir
    ? `${credDir.replace(/[/\\]+$/, '')}/hot_wallet_key`
    : process.env.HOT_WALLET_KEY_FILE?.trim();

  if (!keyPath) {
    throw new Error(
      'Missing HOT_WALLET_KEY_FILE or systemd CREDENTIALS_DIRECTORY for file-based key source.'
    );
  }

  const stat = await fs.stat(keyPath);
  if (process.platform !== 'win32' && !credDir) {
    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `Refusing to load hot wallet key: ${keyPath} has insecure permissions (${mode.toString(8)}); require 600.`
      );
    }
  }

  return await fs.readFile(keyPath, 'utf8');
}

/**
 * Loads the hot wallet signing key purely within the isolated worker process.
 *
 * Attack vectors mitigated:
 * - Secret leakage via process environment dumps (`process.env`, `/proc/<pid>/environ`, APM error payloads):
 *   explicitly aborts if HOT_WALLET_PRIVATE_KEY is present in `process.env`.
 * - Silent key swap attack: pins derived address against expected HOT_WALLET_ADDRESS before returning.
 */
export async function loadIsolatedHotWallet(): Promise<WorkerSigner> {
  // Never permit the private key inside environment variables
  if (process.env.HOT_WALLET_PRIVATE_KEY && process.env.HOT_WALLET_PRIVATE_KEY.trim().length > 0) {
    throw new Error(
      'Security violation: HOT_WALLET_PRIVATE_KEY must NEVER be passed in process.env. Use OCI Vault or chmod 0600 credential file.'
    );
  }

  const expectedRaw = process.env.HOT_WALLET_ADDRESS?.trim();
  if (!expectedRaw) {
    throw new Error('HOT_WALLET_ADDRESS must be pinned in the worker configuration.');
  }
  const expectedAddress = getAddress(expectedRaw);

  const source = (process.env.HOT_WALLET_KEY_SOURCE || 'credential').trim().toLowerCase();
  const rawSecret =
    source === 'oci-vault' ? await readSecretFromOciVault() : await readSecretFromLockedFile();

  const match = KEY_HEX_REGEX.exec(rawSecret.trim());
  if (!match) {
    // Never include secret text in error output
    throw new Error('Hot wallet secret format invalid (expected 32-byte hex private key).');
  }

  const normalizedHex = `0x${match[2]}`;
  const wallet = new Wallet(normalizedHex);

  if (wallet.address !== expectedAddress) {
    throw new Error(
      `Hot wallet address mismatch: loaded key derives ${wallet.address}, expected pinned ${expectedAddress}.`
    );
  }

  return {
    address: wallet.address,
    signTransaction(tx: TransactionRequest): Promise<string> {
      return wallet.signTransaction(tx);
    },
  };
}
