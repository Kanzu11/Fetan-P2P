import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Load local .env for Node test runner when not already injected
function loadDotEnvIfPresent() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnvIfPresent();

import {
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
  parseCookieHeader,
  requireAuth,
  requireAdmin,
  requireSuperadmin,
} from '../server/security/session';
import { createOtpChallenge, verifyAndConsumeOtp } from '../server/security/otp';
import { rateLimiter } from '../server/security/rate-limiter';
import { detectValidatedMimeAndExt, uploadService } from '../server/upload-service';
import { validateCryptoAddress, validateTxHash } from '../server/security/sanitize';
import { verifyOnChainUsdtDeposit } from '../server/blockchain/verify-deposit';
import { db } from '../server/database/store';
import { prisma } from '../server/database/prisma';
import { escrowController } from '../server/escrow-controller';
import { GET as getAdminUsers, POST as postAdminUsers } from '../app/api/admin/users/route';
import { POST as postLegacyDeposit } from '../app/api/user/deposit/route';
import { POST as postWithdraw } from '../app/api/user/withdraw/route';
import { POST as postLegacyLogin } from '../app/api/auth/login/route';
import { POST as postTelegramWebhook } from '../app/api/telegram/webhook/route';
import { GET as getUploadById } from '../app/api/uploads/[id]/route';
import { GET as getOrderById } from '../app/api/orders/[id]/route';

const RUN_TAG = crypto.randomBytes(4).toString('hex');
const createdUserIds: string[] = [];
const createdOfferIds: string[] = [];
const createdOrderIds: string[] = [];
const createdEmails: string[] = [];
const createdRateKeys: string[] = [];

after(async () => {
  try {
    if (createdOrderIds.length > 0) {
      await prisma.chatMessage.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.p2POrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdOfferIds.length > 0) {
      await prisma.p2POffer.deleteMany({ where: { id: { in: createdOfferIds } } });
    }
    if (createdEmails.length > 0) {
      await prisma.otpChallenge.deleteMany({ where: { email: { in: createdEmails } } });
    }
    if (createdRateKeys.length > 0) {
      await prisma.rateLimitRecord.deleteMany({ where: { key: { in: createdRateKeys } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [{ actorId: { in: createdUserIds } }, { targetId: { in: createdUserIds } }],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('Session tokens validate signatures, reject tampering & expiry, and parse cookies', () => {
  const token = signSessionToken('usr-test-1', 'USER', 3600);
  const payload = verifySessionToken(token);
  assert.ok(payload, 'valid session token should verify');
  assert.equal(payload.sub, 'usr-test-1');
  assert.equal(payload.role, 'USER');

  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const tamperedSig = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;
  assert.equal(verifySessionToken(tamperedSig), null, 'tampered signature must fail');

  const expiredToken = signSessionToken('usr-test-1', 'USER', -10);
  assert.equal(verifySessionToken(expiredToken), null, 'expired token must fail');

  const extracted = parseCookieHeader(
    `theme=light; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; lang=en`,
    SESSION_COOKIE_NAME
  );
  assert.equal(extracted, token);
});

test('Upload magic-byte validator accepts real images/PDF and blocks XSS payloads', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj', 'ascii');
  const svgXss = Buffer.from('<svg onload="alert(document.cookie)"></svg>', 'utf8');

  assert.deepEqual(detectValidatedMimeAndExt(png), { mimeType: 'image/png', ext: 'png' });
  assert.deepEqual(detectValidatedMimeAndExt(jpg), { mimeType: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectValidatedMimeAndExt(webp), { mimeType: 'image/webp', ext: 'webp' });
  assert.deepEqual(detectValidatedMimeAndExt(pdf), { mimeType: 'application/pdf', ext: 'pdf' });
  assert.equal(detectValidatedMimeAndExt(svgXss), null);
  assert.equal(detectValidatedMimeAndExt(Buffer.alloc(0)), null);

  await assert.rejects(
    () => uploadService.uploadBuffer(svgXss, 'kyc', 'usr-any'),
    /Unsupported or invalid file format/
  );
  await assert.rejects(
    () => uploadService.uploadBuffer(png, 'kyc', ''),
    /ownerId is required/
  );
});

test('Crypto address & txHash sanitization rejects invalid inputs and missing custody config', async () => {
  assert.equal(validateCryptoAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e', 'BEP20').valid, true);
  assert.equal(validateCryptoAddress('not-an-address', 'BEP20').valid, false);
  assert.equal(validateCryptoAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', 'TRC20').valid, true);
  assert.equal(validateCryptoAddress('invalid-tron', 'TRC20').valid, false);
  assert.equal(validateTxHash('short', 'BEP20').valid, false);

  await assert.rejects(
    () =>
      verifyOnChainUsdtDeposit({
        network: 'BEP20',
        txHash: '0x' + 'a'.repeat(64),
        userAddresses: undefined,
      }),
    /not configured/
  );
});

test('OTP challenges prevent brute-force attempts and replay attacks', async () => {
  const email = `otp-test-${RUN_TAG}@example.com`;
  createdEmails.push(email);

  const first = await createOtpChallenge({ email, purpose: 'LOGIN' });
  assert.match(first.code, /^\d{6}$/);

  const badCode = first.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const attempt = await verifyAndConsumeOtp({ email, purpose: 'LOGIN', code: badCode });
    assert.equal(attempt.valid, false);
  }

  // Even the correct code must now fail after maxAttempts reached
  const lockedAttempt = await verifyAndConsumeOtp({
    email,
    purpose: 'LOGIN',
    code: first.code,
  });
  assert.equal(lockedAttempt.valid, false);

  // Fresh OTP succeeds once, then cannot be replayed
  const second = await createOtpChallenge({ email, purpose: 'WITHDRAW', metadata: { amountUsdt: 25 } });
  const okAttempt = await verifyAndConsumeOtp({
    email,
    purpose: 'WITHDRAW',
    code: second.code,
  });
  assert.equal(okAttempt.valid, true);
  assert.equal(okAttempt.metadata?.amountUsdt, 25);

  const replayAttempt = await verifyAndConsumeOtp({
    email,
    purpose: 'WITHDRAW',
    code: second.code,
  });
  assert.equal(replayAttempt.valid, false);
});

test('Rate limiter persists window counts and blocks excess calls', async () => {
  const key = `test-rl:${RUN_TAG}`;
  createdRateKeys.push(key);

  const r1 = await rateLimiter.checkAsync(key, 2, 60);
  const r2 = await rateLimiter.checkAsync(key, 2, 60);
  const r3 = await rateLimiter.checkAsync(key, 2, 60);

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, false);
  assert.ok(r3.resetSeconds > 0);
});

test('Unauthenticated & legacy endpoints fail closed with 401/410', async () => {
  const authFail = await requireAuth(new Request('http://localhost/api/test'));
  assert.equal(authFail.ok, false);
  if (!authFail.ok) assert.equal(authFail.response.status, 401);

  const legacyDepositRes = await postLegacyDeposit();
  assert.equal(legacyDepositRes.status, 410);

  const legacyLoginRes = await postLegacyLogin();
  assert.equal(legacyLoginRes.status, 410);

  const adminUsersUnauth = await getAdminUsers(new Request('http://localhost/api/admin/users'));
  assert.equal(adminUsersUnauth.status, 401);

  const withdrawUnauth = await postWithdraw(
    new Request('http://localhost/api/user/withdraw', { method: 'POST', body: '{}' })
  );
  assert.equal(withdrawUnauth.status, 401);

  const webhookUnauth = await postTelegramWebhook(
    new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
      body: JSON.stringify({ update_id: 1 }),
    })
  );
  assert.equal(webhookUnauth.status, 401);

  const uploadUnauth = await getUploadById(new Request('http://localhost/api/uploads/none'), {
    params: { id: 'none' },
  });
  assert.equal(uploadUnauth.status, 401);
});

test('RBAC boundaries & PostgreSQL escrow lock -> pay -> release / cancel invariants', async () => {
  const createdSeller = await db.createUser({
    email: `merchant-${RUN_TAG}@example.com`,
    name: `Merchant ${RUN_TAG}`,
    role: 'MERCHANT',
    kycStatus: 'VERIFIED',
  });
  const seller = await db.updateUser(createdSeller.id, {
    merchantStatus: 'APPROVED',
    usdtBalance: 200,
    paymentDetails: {
      telebirr: '0911000001',
    },
  });
  const buyer = await db.createUser({
    email: `buyer-${RUN_TAG}@example.com`,
    name: `Buyer ${RUN_TAG}`,
    role: 'USER',
    kycStatus: 'VERIFIED',
  });
  const outsider = await db.createUser({
    email: `outsider-${RUN_TAG}@example.com`,
    name: `Outsider ${RUN_TAG}`,
    role: 'ADMIN',
    kycStatus: 'VERIFIED',
  });
  createdUserIds.push(seller.id, buyer.id, outsider.id);

  // RBAC: regular USER cannot read /api/admin/users; regular ADMIN cannot TOGGLE_ADMIN
  const buyerCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    signSessionToken(buyer.id, buyer.role)
  )}`;
  const adminCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    signSessionToken(outsider.id, outsider.role)
  )}`;

  const buyerAdminCheck = await requireAdmin(
    new Request('http://localhost/api/admin/users', { headers: { cookie: buyerCookie } })
  );
  assert.equal(buyerAdminCheck.ok, false);
  if (!buyerAdminCheck.ok) assert.equal(buyerAdminCheck.response.status, 403);

  const adminSuperCheck = await requireSuperadmin(
    new Request('http://localhost/api/admin/users', { headers: { cookie: adminCookie } })
  );
  assert.equal(adminSuperCheck.ok, false);
  if (!adminSuperCheck.ok) assert.equal(adminSuperCheck.response.status, 403);

  const toggleAdminRes = await postAdminUsers(
    new Request('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ targetUserId: buyer.id, action: 'TOGGLE_ADMIN', newRole: 'ADMIN' }),
    })
  );
  assert.equal(toggleAdminRes.status, 403);

  // Create SELL offer backed by seller's 200 USDT
  const offer = await db.createOffer({
    id: `off-test-${RUN_TAG}`,
    merchantId: seller.id,
    merchantName: seller.name,
    completedTrades: 0,
    completionRate: 100,
    offerType: 'SELL',
    pricePerUsdtEtb: 160,
    minLimitEtb: 100,
    maxLimitEtb: 50000,
    totalAvailable: 100,
    paymentMethods: ['TELEBIRR'],
    terms: 'Fast transfer only',
    isActive: true,
    isOnline: true,
    isVerifiedMerchant: true,
    createdAt: new Date().toISOString(),
  });
  createdOfferIds.push(offer.id);

  // 1. Lock 25 USDT in escrow
  const order1 = await escrowController.lockEscrow({
    offerId: offer.id,
    buyerId: buyer.id,
    usdtAmount: 25,
    paymentMethod: 'TELEBIRR',
  });
  createdOrderIds.push(order1.id);

  const sellerAfterLock = await db.getUser(seller.id);
  const offerAfterLock = await db.getOffer(offer.id);
  assert.equal(sellerAfterLock?.usdtBalance, 175);
  assert.equal(sellerAfterLock?.usdtLocked, 25);
  assert.equal(offerAfterLock?.totalAvailable, 75);

  // Unauthorized release by buyer must throw
  await assert.rejects(
    () => escrowController.releaseEscrow(order1.id, buyer.id),
    /Only the seller/
  );

  // Mark paid & verify route participation works cleanly
  const paidOrder = await escrowController.confirmPayment(order1.id, buyer.id);
  assert.equal(paidOrder.status, 'PAYMENT_SENT');

  const getOrderRes = await getOrderById(
    new Request(`http://localhost/api/orders/${order1.id}`, {
      headers: { cookie: buyerCookie },
    }),
    { params: { id: order1.id } }
  );
  assert.equal(getOrderRes.status, 200);

  // Seller releases escrow -> transfers 25 USDT to buyer
  const released = await escrowController.releaseEscrow(order1.id, seller.id);
  assert.equal(released.status, 'COMPLETED');

  const sellerAfterRelease = await db.getUser(seller.id);
  const buyerAfterRelease = await db.getUser(buyer.id);
  assert.equal(sellerAfterRelease?.usdtLocked, 0);
  assert.equal(sellerAfterRelease?.usdtBalance, 175);
  assert.equal(buyerAfterRelease?.usdtBalance, 25);

  // 2. Lock 15 USDT and cancel -> refunds locked USDT to seller available & offer
  const order2 = await escrowController.lockEscrow({
    offerId: offer.id,
    buyerId: buyer.id,
    usdtAmount: 15,
    paymentMethod: 'TELEBIRR',
  });
  createdOrderIds.push(order2.id);

  const sellerDuringOrder2 = await db.getUser(seller.id);
  assert.equal(sellerDuringOrder2?.usdtBalance, 160);
  assert.equal(sellerDuringOrder2?.usdtLocked, 15);

  const cancelled = await escrowController.cancelEscrow(order2.id, buyer.id, 'Buyer changed mind');
  assert.equal(cancelled.status, 'CANCELLED');

  const sellerAfterCancel = await db.getUser(seller.id);
  const offerAfterCancel = await db.getOffer(offer.id);
  assert.equal(sellerAfterCancel?.usdtLocked, 0);
  assert.equal(sellerAfterCancel?.usdtBalance, 175);
  assert.equal(offerAfterCancel?.totalAvailable, 75);
});

