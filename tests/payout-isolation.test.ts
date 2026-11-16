import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN_SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'HOT_WALLET_PRIVATE_KEY reference', regex: /HOT_WALLET_PRIVATE_KEY/ },
  { label: 'HOT_WALLET_KEY_FILE reference', regex: /HOT_WALLET_KEY_FILE/ },
  { label: 'OCI_VAULT_SECRET_OCID reference', regex: /OCI_VAULT_SECRET_OCID/ },
  { label: 'CREDENTIALS_DIRECTORY reference', regex: /CREDENTIALS_DIRECTORY/ },
  { label: 'payout-engine worker import', regex: /workers\/payout-engine/ },
  { label: 'raw private-key ethers Wallet constructor', regex: /new\s+Wallet\s*\(/ },
];

function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test('Phase 3 Security Isolation: web app and server directories never reference worker signing keys or Wallet()', () => {
  const scanDirs = ['app', 'client', 'server', 'middleware.ts'];
  const targets: string[] = [];

  for (const rel of scanDirs) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) targets.push(...collectTsFiles(full));
    else targets.push(full);
  }

  assert.ok(targets.length > 0, 'Expected web source files to scan');

  for (const filePath of targets) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(ROOT, filePath);
    for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
      assert.equal(
        pattern.regex.test(content),
        false,
        `Security isolation breach in ${relPath}: forbidden ${pattern.label}`
      );
    }
  }
});
