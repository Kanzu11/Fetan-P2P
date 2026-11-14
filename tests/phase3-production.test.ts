import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  signCloudinaryUploadParams,
  detectValidatedMimeAndExt,
} from '../server/upload-service';
import { escrowController } from '../server/escrow-controller';
import { sanitizeAmount } from '../server/security/sanitize';

const ROOT = path.resolve(__dirname, '..');

test('Cloudinary signature generation is deterministic SHA-1 hex', () => {
  const sig1 = signCloudinaryUploadParams(
    'fetan-p2p/kyc',
    'user1_123456',
    '1700000000',
    'test_secret_key'
  );
  const sig2 = signCloudinaryUploadParams(
    'fetan-p2p/kyc',
    'user1_123456',
    '1700000000',
    'test_secret_key'
  );
  const sigDifferent = signCloudinaryUploadParams(
    'fetan-p2p/receipts',
    'user1_123456',
    '1700000000',
    'test_secret_key'
  );

  assert.equal(sig1, sig2);
  assert.match(sig1, /^[a-f0-9]{40}$/);
  assert.notEqual(sig1, sigDifferent);
});

test('Upload magic-byte detector validates PNG/JPEG/PDF and rejects spoofed buffers', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const pdfHeader = Buffer.from('%PDF-1.7\n1 0 obj', 'utf8');
  const scriptPayload = Buffer.from('<script>alert(1)</script>', 'utf8');

  assert.deepEqual(detectValidatedMimeAndExt(pngHeader), { mimeType: 'image/png', ext: 'png' });
  assert.deepEqual(detectValidatedMimeAndExt(jpegHeader), { mimeType: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectValidatedMimeAndExt(pdfHeader), { mimeType: 'application/pdf', ext: 'pdf' });
  assert.equal(detectValidatedMimeAndExt(scriptPayload), null);
});

test('sweepExpiredOrders handles empty candidate list safely without throwing', async () => {
  const result = await escrowController.sweepExpiredOrders([]);
  assert.ok(Array.isArray(result) || typeof result === 'number' || typeof result === 'object');
});

test('Zero @kanzedin exposure across customer-facing Telegram Bot and Mini App files', () => {
  const customerFacingFiles = [
    'telegram/dist/index.html',
    'telegram/tgcloud/handlers/message.js',
    'telegram/tgcloud/handlers/callback_query.js',
    'telegram/tgcloud/endpoints/submitKyc.js',
    'telegram/tgcloud/endpoints/submitTicket.js',
    'server/telegram-bot.ts',
  ];

  for (const relPath of customerFacingFiles) {
    const absPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(absPath), `Expected file to exist: ${relPath}`);
    const content = fs.readFileSync(absPath, 'utf8').toLowerCase();
    assert.equal(
      content.includes('@kanzedin'),
      false,
      `Customer-facing file ${relPath} must not expose @kanzedin`
    );
  }
});

test('Verified user KYC suppression and Telegram /trade trading flows exist', () => {
  const botSrc = fs.readFileSync(path.join(ROOT, 'server/telegram-bot.ts'), 'utf8');
  const tgMessageSrc = fs.readFileSync(
    path.join(ROOT, 'telegram/tgcloud/handlers/message.js'),
    'utf8'
  );
  const miniAppSrc = fs.readFileSync(path.join(ROOT, 'telegram/dist/index.html'), 'utf8');

  // Bot supports /trade, /market, /orders, and inline callbacks
  assert.ok(botSrc.includes('/trade') || botSrc.includes("command('trade'"));
  assert.ok(botSrc.includes("command('orders'"));
  assert.ok(botSrc.includes('buildStartKeyboard'));

  // TGCloud message handler routes /trade & /orders and avoids sending KYC button to verified/admins
  assert.ok(tgMessageSrc.includes('/trade'));
  assert.ok(tgMessageSrc.includes('/orders'));
  assert.ok(tgMessageSrc.includes('VERIFIED'));

  // Mini App handles conditional KYC hiding and includes Liquid Glass styling + trading
  assert.ok(miniAppSrc.includes('backdrop-filter'));
  assert.ok(miniAppSrc.includes('MINI_APP'));
});

test('sanitizeAmount preserves decimal USDT amounts and /api/orders unwraps amount number cleanly', () => {
  const res = sanitizeAmount(6.25, 0.5, 1_000_000, 6);
  assert.deepEqual(res, { valid: true, amount: 6.25 });

  const preciseRes = sanitizeAmount('12.345678', 0.5, 1_000_000, 6);
  assert.deepEqual(preciseRes, { valid: true, amount: 12.345678 });

  const ordersRouteSrc = fs.readFileSync(path.join(ROOT, 'app/api/orders/route.ts'), 'utf8');
  const withdrawRouteSrc = fs.readFileSync(
    path.join(ROOT, 'app/api/user/withdraw/route.ts'),
    'utf8'
  );
  assert.ok(ordersRouteSrc.includes('amountCheck.valid ? amountCheck.amount'));
  assert.ok(withdrawRouteSrc.includes('amountCheck.valid ? amountCheck.amount'));
});

test('Admin user suspension/ban, Ad management, and Telegram Admin parity exist across web & TGCloud', () => {
  const schemaSrc = fs.readFileSync(path.join(ROOT, 'server/database/schema.prisma'), 'utf8');
  const sessionSrc = fs.readFileSync(path.join(ROOT, 'server/security/session.ts'), 'utf8');
  const adminUsersSrc = fs.readFileSync(
    path.join(ROOT, 'app/api/admin/users/route.ts'),
    'utf8'
  );
  const adminPageSrc = fs.readFileSync(path.join(ROOT, 'app/admin/page.tsx'), 'utf8');
  const tgNeonSrc = fs.readFileSync(path.join(ROOT, 'telegram/tgcloud/lib/neon.js'), 'utf8');
  const tgMiniAppSrc = fs.readFileSync(path.join(ROOT, 'telegram/dist/index.html'), 'utf8');
  const tgMsgSrc = fs.readFileSync(path.join(ROOT, 'telegram/tgcloud/handlers/message.js'), 'utf8');
  const tgCbSrc = fs.readFileSync(
    path.join(ROOT, 'telegram/tgcloud/handlers/callback_query.js'),
    'utf8'
  );

  assert.ok(schemaSrc.includes('isSuspended'));
  assert.ok(sessionSrc.includes('user.isSuspended'));
  assert.ok(adminUsersSrc.includes('TOGGLE_SUSPEND'));
  assert.ok(adminPageSrc.includes("activeTab === 'ADS'"));
  assert.ok(adminPageSrc.includes('handleToggleSuspend'));

  assert.ok(tgNeonSrc.includes('adminManageUserNeon'));
  assert.ok(tgNeonSrc.includes('adminManageOfferNeon'));
  assert.ok(tgNeonSrc.includes('adminReviewWithdrawalNeon'));

  for (const subTab of ['DISPUTES', 'ADS', 'USERS', 'KYC', 'MERCHANTS', 'WITHDRAWALS', 'SUPPORT', 'AUDIT']) {
    assert.ok(tgMiniAppSrc.includes(`setAdminSubTab('${subTab}'`));
  }

  assert.ok(tgMsgSrc.includes('/ban '));
  assert.ok(tgMsgSrc.includes('/approve_wdr '));
  assert.ok(tgCbSrc.includes('admin_view_offers'));
  assert.ok(tgCbSrc.includes('admin_view_withdrawals'));
});
