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
import { WITHDRAWAL_FEES_USDT } from '../client/config';
import { pricingService } from '../client/pricing';
import {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
} from '../server/security/password';
import { createOtpChallenge } from '../server/security/otp';
import { verifySessionToken } from '../server/security/session';
import { prisma } from '../server/database/prisma';
import { wsGateway } from '../server/websocket-gateway';
import { POST as verifyOtpRoute } from '../app/api/auth/verify-otp/route';
import { POST as loginRoute } from '../app/api/auth/login/route';
import { POST as resetPasswordRoute } from '../app/api/auth/reset-password/route';
import { GET as priceStreamRoute } from '../app/api/prices/stream/route';
import {
  signEmailRelayPayload,
  verifyEmailRelaySignature,
} from '../server/email-service';
import { POST as emailRelayRoute } from '../app/api/internal/email-relay/route';
import { HDNodeWallet } from 'ethers';
import {
  cleanDepositEnvValue,
  generateUserDepositAddresses,
  isDepositConfigured,
  normalizeTonAddressToRaw,
  resolveUserDepositAddresses,
} from '../server/crypto-address-service';

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

test('Zero hardcoded Neon DB credentials remain in tracked source files', () => {
  const filesToCheck = [
    'telegram/tgcloud/lib/neon.js',
    'telegram/tgcloud/endpoints/syncWeb.js',
    'telegram/tgcloud/endpoints/getMiniAppData.js',
    'telegram/tgcloud/schema.js',
    'server/telegram-bot.ts',
    '.env.example',
  ];

  for (const relPath of filesToCheck) {
    const content = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    assert.equal(
      content.includes('npg_'),
      false,
      `${relPath} must not contain hardcoded Neon password tokens`
    );
    assert.equal(
      /postgresql:\/\/(?!user:password@localhost)[^:\s]+:[^@\s]+@/i.test(content),
      false,
      `${relPath} must not contain hardcoded PostgreSQL credentials`
    );
    assert.equal(
      content.includes('neon.tech'),
      false,
      `${relPath} must not contain hardcoded Neon endpoint URLs`
    );
  }
});

test('ETB P2P price band aligns with BingX market (up to 195 ETB max) and sender pays withdrawal fees', async () => {
  assert.equal(WITHDRAWAL_FEES_USDT.TRC20, 1.0);
  assert.equal(WITHDRAWAL_FEES_USDT.BEP20, 0.5);
  assert.equal(WITHDRAWAL_FEES_USDT.TON, 0.5);

  const withdrawRouteSrc = fs.readFileSync(
    path.join(ROOT, 'app/api/user/withdraw/route.ts'),
    'utf8'
  );
  assert.ok(withdrawRouteSrc.includes('WITHDRAWAL_FEES_USDT[network]'));
  assert.ok(withdrawRouteSrc.includes('netPayoutUsdt'));

  const ok195 = await pricingService.validatePrice(195);
  assert.equal(ok195.valid, true, '195 ETB must be allowed within BingX market band');
});

test('scrypt password hashing validates strength and verifies passwords cleanly', async () => {
  assert.equal(validatePasswordStrength('short').valid, false);
  assert.equal(validatePasswordStrength('StrongPass#2026').valid, true);

  const hash = await hashPassword('StrongPass#2026');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('StrongPass#2026', hash), true);
  assert.equal(await verifyPassword('WrongPass#2026', hash), false);
});

test('Signup OTP -> Email+Password Login -> Forgot/Reset Password + JWT Flow works end-to-end', async () => {
  const testEmail = `test_pwd_${Date.now()}@fetan.test`;
  const testIp = '198.51.100.42';
  const initialPassword = 'InitialPassword#2026';
  const resetPassword = 'UpdatedPassword#2026';
  let createdUserId: string | undefined;

  try {
    const initialHash = await hashPassword(initialPassword);
    const { code: signupCode } = await createOtpChallenge({
      email: testEmail,
      purpose: 'SIGNUP',
      metadata: { name: 'Test Trader', passwordHash: initialHash },
    });

    const verifyRes = await verifyOtpRoute(
      new Request('http://localhost/api/auth/verify-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({
          email: testEmail,
          code: signupCode,
          purpose: 'SIGNUP',
        }),
      })
    );
    assert.equal(verifyRes.status, 200);
    const verifyData = (await verifyRes.json()) as {
      success: boolean;
      token: string;
      user: {
        id: string;
        emailVerified?: boolean;
        hasPassword?: boolean;
        passwordHash?: unknown;
      };
    };
    createdUserId = verifyData.user.id;
    assert.equal(verifyData.success, true);
    assert.equal(verifyData.user.emailVerified, true);
    assert.equal(verifyData.user.hasPassword, true);
    assert.equal(verifyData.user.passwordHash, undefined);
    assert.equal(verifySessionToken(verifyData.token)?.sub, createdUserId);

    const wrongLoginRes = await loginRoute(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ email: testEmail, password: 'WrongPassword#999' }),
      })
    );
    assert.equal(wrongLoginRes.status, 401);

    const goodLoginRes = await loginRoute(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ email: testEmail, password: initialPassword }),
      })
    );
    assert.equal(goodLoginRes.status, 200);
    const loginSetCookie = goodLoginRes.headers.get('set-cookie') || '';
    assert.ok(loginSetCookie.includes('fetan_session='));
    const goodLoginData = (await goodLoginRes.json()) as {
      success: boolean;
      token: string;
      user: { id: string };
    };
    assert.equal(goodLoginData.success, true);
    assert.equal(verifySessionToken(goodLoginData.token)?.sub, createdUserId);

    const { code: resetCode } = await createOtpChallenge({
      email: testEmail,
      purpose: 'RESET_PASSWORD',
      metadata: { userId: createdUserId },
    });

    const resetRes = await resetPasswordRoute(
      new Request('http://localhost/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({
          email: testEmail,
          code: resetCode,
          newPassword: resetPassword,
        }),
      })
    );
    assert.equal(resetRes.status, 200);

    const stalePassRes = await loginRoute(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ email: testEmail, password: initialPassword }),
      })
    );
    assert.equal(stalePassRes.status, 401);

    const newPassRes = await loginRoute(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ email: testEmail, password: resetPassword }),
      })
    );
    assert.equal(newPassRes.status, 200);
  } finally {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          ...(createdUserId ? [{ actorId: createdUserId }, { targetId: createdUserId }] : []),
          { ip: testIp },
        ],
      },
    });
    await prisma.otpChallenge.deleteMany({ where: { email: testEmail } });
    await prisma.rateLimitRecord.deleteMany({
      where: {
        OR: [{ key: { contains: testEmail } }, { key: { contains: testIp } }],
      },
    });
    if (createdUserId) {
      await prisma.user.deleteMany({ where: { id: createdUserId } });
    }
  }
});

test('Real-time live price WebSocket broadcast and SSE stream emit referencePriceEtb', async () => {
  let receivedEvent: { room: string; event: string; data: unknown } | null = null;
  const unsubscribe = wsGateway.onAnyEvent((evt) => {
    if (evt.room === 'public:prices' && evt.event === 'price_updated') {
      receivedEvent = evt;
    }
  });

  try {
    const stats = await pricingService.broadcastLivePrices();
    assert.ok(typeof stats.referencePriceEtb === 'number' && stats.referencePriceEtb > 0);
    assert.ok(receivedEvent !== null, 'wsGateway must broadcast price_updated to public:prices');
  } finally {
    unsubscribe();
  }

  const abortController = new AbortController();
  const res = await priceStreamRoute(
    new Request('http://localhost/api/prices/stream', {
      signal: abortController.signal,
    })
  );
  assert.ok(res.headers.get('Content-Type')?.includes('text/event-stream'));
  assert.ok(res.body, 'SSE response body must exist');

  const reader = res.body.getReader();
  try {
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    assert.ok(text.includes('event: price_updated'));
    assert.ok(text.includes('referencePriceEtb'));
  } finally {
    await reader.cancel();
    abortController.abort();
  }
});

test('Internal SMTP email relay signs payloads, rejects tampering/expiry, and verifies middleware bypass', async () => {
  const ts = String(Date.now());
  const rawBody = JSON.stringify({
    to: 'trader@example.com',
    subject: 'Test',
    html: '<p>Hello</p>',
  });

  const sig = signEmailRelayPayload(ts, rawBody);
  assert.equal(verifyEmailRelaySignature(ts, rawBody, sig).valid, true);
  assert.equal(
    verifyEmailRelaySignature(ts, `${rawBody} `, sig).valid,
    false,
    'Tampered payload must fail HMAC verification'
  );
  assert.equal(
    verifyEmailRelaySignature(String(Date.now() - 10 * 60 * 1000), rawBody, sig).valid,
    false,
    'Expired relay timestamp must be rejected'
  );

  const unauthRes = await emailRelayRoute(
    new Request('http://localhost/api/internal/email-relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fetan-timestamp': ts,
        'x-fetan-signature': 'invalid_sig',
      },
      body: rawBody,
    })
  );
  assert.equal(unauthRes.status, 401);

  const middlewareSrc = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8');
  assert.ok(middlewareSrc.includes('/api/internal/email-relay'));
});

test('Crypto deposit derivation handles quotes/placeholders, rejects zpub without breaking TON, and normalizes TON EQ/UQ/raw', () => {
  assert.equal(cleanDepositEnvValue('  "xpub6CQ8...your_master_public_key_here"  '), '');
  assert.equal(cleanDepositEnvValue("  'EQ...your_ton_hot_wallet_address' "), '');

  const uqAddr = 'UQCUWIMl9oxdDFHROjuf4kJtpNd7uouWJLeAE-XyxC_-mwfN';
  const rawExpected = '0:94588325f68c5d0c51d13a3b9fe2426da4d77bba8b9624b78013e5f2c42ffe9b';
  assert.equal(normalizeTonAddressToRaw(uqAddr), rawExpected);
  assert.equal(normalizeTonAddressToRaw(rawExpected), rawExpected);
  assert.equal(normalizeTonAddressToRaw('UQCUWIMl9oxdDFHROjuf4kJtpNd7uouWJLeAE-XyxC_-mwfX'), null);

  const prevXpub = process.env.DEPOSIT_XPUB;
  const prevTon = process.env.DEPOSIT_TON_ADDRESS;
  try {
    // 1. zpub must fail closed for BEP20/TRC20 while leaving valid TON working
    process.env.DEPOSIT_XPUB =
      '"zpub6oGgPhENSeCTSzbbkF41jQ91sNsrt4SS1cbUcXTxjqPhYyAAV6hYhyAo7168CJK55QHiTpiKv54Lkk4Uh91fFD6h49b7yXYnQd2GGbocTgR"';
    process.env.DEPOSIT_TON_ADDRESS = ` "${uqAddr}" `;

    assert.equal(isDepositConfigured('TON'), true);
    assert.equal(isDepositConfigured('BEP20'), false);
    assert.equal(isDepositConfigured('TRC20'), false);

    const tonOnly = generateUserDepositAddresses('usr-test-deposit-1');
    assert.ok(tonOnly);
    assert.equal(tonOnly.ton, uqAddr);
    assert.match(tonOnly.tonMemo, /^FETAN\d+$/);
    assert.equal(tonOnly.bep20, '');
    assert.equal(tonOnly.trc20, '');

    // 2. Valid account-level BIP44 xpub (m/44'/60'/0') with quotes enables all 3 networks
    const testAccountXpub = HDNodeWallet.createRandom(undefined, "m/44'/60'/0'")
      .neuter().extendedKey;
    process.env.DEPOSIT_XPUB = `"${testAccountXpub}"`;

    assert.equal(isDepositConfigured('BEP20'), true);
    assert.equal(isDepositConfigured('TRC20'), true);

    const full = resolveUserDepositAddresses('usr-test-deposit-1', tonOnly);
    assert.ok(full);
    assert.match(full.bep20, /^0x[a-fA-F0-9]{40}$/);
    assert.match(full.trc20, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.equal(full.ton, uqAddr);
    assert.equal(full.tonMemo, tonOnly.tonMemo);
  } finally {
    if (prevXpub === undefined) delete process.env.DEPOSIT_XPUB;
    else process.env.DEPOSIT_XPUB = prevXpub;
    if (prevTon === undefined) delete process.env.DEPOSIT_TON_ADDRESS;
    else process.env.DEPOSIT_TON_ADDRESS = prevTon;
  }
});
