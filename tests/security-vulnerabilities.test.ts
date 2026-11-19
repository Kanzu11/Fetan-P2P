import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

import { prisma } from '../server/database/prisma';
import { db } from '../server/database/store';
import { hashPassword } from '../server/security/password';
import { createOtpChallenge } from '../server/security/otp';
import { getClientIp } from '../server/security/rate-limiter';
import {
  escapeHtml,
  isAllowedCloudinaryUrl,
  isAllowedPlatformAssetUrl,
} from '../server/security/sanitize';
import {
  SESSION_COOKIE_NAME,
  parseCookieHeader,
  signSessionToken,
  verifySessionToken,
} from '../server/security/session';
import { signEmailRelayPayload } from '../server/email-service';
import { POST as postLogin } from '../app/api/auth/login/route';
import { POST as postResetPassword } from '../app/api/auth/reset-password/route';
import { POST as postRequestOtp } from '../app/api/auth/request-otp/route';
import { POST as postWithdraw } from '../app/api/user/withdraw/route';
import { GET as getProfile, POST as postProfile } from '../app/api/user/profile/route';
import { POST as postKyc } from '../app/api/user/kyc/route';
import { GET as getUploadById } from '../app/api/uploads/[id]/route';
import { PATCH as patchOfferById } from '../app/api/offers/[id]/route';
import { POST as postEmailRelay } from '../app/api/internal/email-relay/route';

const RUN_TAG = crypto.randomBytes(4).toString('hex');
const createdUserIds: string[] = [];
const createdOfferIds: string[] = [];
const createdUploadIds: string[] = [];
const createdEmails: string[] = [];
const createdRateKeys: string[] = [];

function randomTestIp(): string {
  return `198.51.100.${10 + Math.floor(Math.random() * 200)}`;
}

function cookieFor(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

after(async () => {
  try {
    if (createdUploadIds.length > 0) {
      await prisma.uploadedFile.deleteMany({ where: { id: { in: createdUploadIds } } });
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
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL fetan.allow_test_ledger_cleanup = 'on'`);
        await tx.walletBalance.deleteMany({ where: { userId: { in: createdUserIds } } });
        await tx.withdrawalBroadcast.deleteMany({
          where: { withdrawal: { userId: { in: createdUserIds } } },
        });
        await tx.withdrawal.deleteMany({ where: { userId: { in: createdUserIds } } });
        await tx.auditLog.deleteMany({
          where: {
            OR: [{ actorId: { in: createdUserIds } }, { targetId: { in: createdUserIds } }],
          },
        });
        await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
      });
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('CRITICAL-1: TGCloud endpoints strictly require signed initData/syncSecret and reject input.user / non-Neon DB hosts', () => {
  const root = process.cwd();
  const miniAppSrc = fs.readFileSync(
    path.join(root, 'telegram', 'tgcloud', 'endpoints', 'getMiniAppData.js'),
    'utf8'
  );
  const submitKycSrc = fs.readFileSync(
    path.join(root, 'telegram', 'tgcloud', 'endpoints', 'submitKyc.js'),
    'utf8'
  );
  const submitTicketSrc = fs.readFileSync(
    path.join(root, 'telegram', 'tgcloud', 'endpoints', 'submitTicket.js'),
    'utf8'
  );
  const syncWebSrc = fs.readFileSync(
    path.join(root, 'telegram', 'tgcloud', 'endpoints', 'syncWeb.js'),
    'utf8'
  );
  const neonSrc = fs.readFileSync(path.join(root, 'telegram', 'tgcloud', 'lib', 'neon.js'), 'utf8');
  const messageSrc = fs.readFileSync(
    path.join(root, 'telegram', 'tgcloud', 'handlers', 'message.js'),
    'utf8'
  );
  const botSrc = fs.readFileSync(path.join(root, 'server', 'telegram-bot.ts'), 'utf8');

  for (const src of [miniAppSrc, submitKycSrc, submitTicketSrc]) {
    assert.equal(
      /\binput\?\.user\b/.test(src),
      false,
      'Untrusted input?.user fallback must be removed'
    );
    assert.ok(src.includes('ctx?.initData?.user'), 'Signed ctx?.initData?.user check is required');
    assert.ok(src.includes('escapeHtml'), 'Telegram HTML alerts must use escapeHtml');
  }

  assert.equal(neonSrc.includes("'kanzedin'"), false, 'Hardcoded superadmin username must not exist');
  assert.equal(
    neonSrc.includes('LOWER("telegramHandle")'),
    false,
    'Mutable telegramHandle lookup must not auto-bind accounts'
  );
  assert.equal(messageSrc.includes('OR "id" = $3'), false, '/start linking must never match user id');
  assert.ok(messageSrc.includes('"telegramLinkCode" = $3'), '/start must match one-time link code');
  assert.ok(syncWebSrc.includes('TELEGRAM_SYNC_SECRET'), 'syncWeb must verify shared sync secret');
  assert.ok(
    syncWebSrc.includes("parsedEndpoint.protocol !== 'https:'"),
    'syncWeb must enforce HTTPS SQL endpoint on matching host'
  );
  assert.equal(botSrc.includes('secret: cloudToken'), false, 'Bot must not transmit TGCLOUD_TOKEN in sync body');
});

test('CRITICAL-2: Telegram linking uses 64-bit one-time codes, blocks userId/handle hijack, and locks profile chatId edits', async () => {
  const email = `sec-tg-${RUN_TAG}@example.com`;
  createdEmails.push(email);

  const victim = await db.createUser({
    email,
    name: `Victim ${RUN_TAG}`,
    telegramHandle: `@victim_${RUN_TAG}`,
  });
  createdUserIds.push(victim.id);

  assert.ok(victim.telegramLinkCode, 'User should receive a telegramLinkCode on creation');
  assert.match(
    victim.telegramLinkCode,
    /^FETAN-[A-F0-9]{16}$/,
    'telegramLinkCode must use 64-bit hex entropy'
  );

  const attackerChatId = `99000${RUN_TAG}`;
  const legitimateChatId = `88000${RUN_TAG}`;

  // Attempt 1: linking by public userId must fail
  const byIdAttempt = await db.linkTelegramAccount(victim.id, attackerChatId, 'attacker');
  assert.equal(byIdAttempt, undefined, 'Linking by userId must be rejected');

  // Attempt 2: linking by matching telegramHandle with invalid code must fail
  const byHandleAttempt = await db.linkTelegramAccount(
    'FETAN-INVALIDCODE1',
    attackerChatId,
    `victim_${RUN_TAG}`
  );
  assert.equal(byHandleAttempt, undefined, 'Linking by handle alone must be rejected');

  // Attempt 3: valid one-time code binds chatId and rotates the code
  const linked = await db.linkTelegramAccount(victim.telegramLinkCode, legitimateChatId, `victim_${RUN_TAG}`);
  assert.ok(linked, 'Valid one-time code must link successfully');
  assert.equal(linked.telegramChatId, legitimateChatId);
  assert.ok(
    linked.telegramLinkCode && linked.telegramLinkCode !== victim.telegramLinkCode,
    'telegramLinkCode must rotate after successful bind'
  );

  // Replaying the old code fails
  const replay = await db.linkTelegramAccount(victim.telegramLinkCode, attackerChatId, 'attacker');
  assert.equal(replay, undefined, 'Consumed link code cannot be replayed');

  // Calling with the new rotated code from a DIFFERENT chatId refuses hijacking already-linked account
  const hijackAttempt = await db.linkTelegramAccount(
    linked.telegramLinkCode,
    attackerChatId,
    'attacker'
  );
  assert.equal(hijackAttempt, undefined, 'Already-linked telegramChatId must not be overwritten by another chatId');

  // Profile POST rejects manual arbitrary telegramChatId
  const victimToken = signSessionToken(victim.id, victim.role);
  const ip = randomTestIp();
  const spoofRes = await postProfile(
    new Request('http://localhost/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(victimToken),
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ telegramChatId: attackerChatId }),
    })
  );
  assert.equal(spoofRes.status, 400, 'Arbitrary telegramChatId override via profile POST must return 400');

  // Empty string unlinks cleanly
  const unlinkRes = await postProfile(
    new Request('http://localhost/api/user/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(victimToken),
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ telegramChatId: '' }),
    })
  );
  assert.equal(unlinkRes.status, 200);
  const unlinkData = (await unlinkRes.json()) as { user: { telegramChatId?: string } };
  assert.equal(unlinkData.user.telegramChatId, undefined);
});

test('HIGH-1: Withdrawal OTPs require bound amount/network/destination on both issuance and consumption', async () => {
  const email = `sec-otp-${RUN_TAG}@example.com`;
  const testIp = randomTestIp();
  createdEmails.push(email);

  const user = await db.createUser({
    email,
    name: `Withdraw OTP ${RUN_TAG}`,
    kycStatus: 'VERIFIED',
  });
  await db.updateUser(user.id, { usdtBalance: 100 });
  createdUserIds.push(user.id);
  createdRateKeys.push(
    `otp-ip:${testIp}`,
    `otp-email:WITHDRAW:${email}`,
    `wdr:rl:user:${user.id}`,
    `wdr:rl:ip:${testIp}`
  );

  const userToken = signSessionToken(user.id, user.role);

  // Missing tuple fields on request-otp must return 400
  const unboundReqRes = await postRequestOtp(
    new Request('http://localhost/api/auth/request-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(userToken),
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({ purpose: 'WITHDRAW' }),
    })
  );
  assert.equal(unboundReqRes.status, 400, 'WITHDRAW OTP request without tuple must fail with 400');

  // Even if an unbound OTP row existed with empty metadata, /api/user/withdraw must reject it (fail closed)
  const unboundChallenge = await createOtpChallenge({
    email,
    purpose: 'WITHDRAW',
    metadata: {},
  });

  const withdrawRes = await postWithdraw(
    new Request('http://localhost/api/user/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(userToken),
        'idempotency-key': crypto.randomUUID(),
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({
        amountUsdt: '25.00',
        network: 'BEP20',
        destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        otpCode: unboundChallenge.code,
      }),
    })
  );
  assert.equal(withdrawRes.status, 400, 'Withdrawal using unbound OTP metadata must fail with 400');
});

test('HIGH-2: JWT rejects non-HS256 alg headers, omits token from auth JSON, and revokes old sessions on password reset', async () => {
  // Forge alg:none header signed with dev/env secret
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const fakePayload = Buffer.from(
    JSON.stringify({
      sub: 'usr-forged',
      role: 'SUPERADMIN',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url');
  const secret = (process.env.JWT_SECRET?.trim() && !process.env.JWT_SECRET.startsWith('replace_with_'))
    ? process.env.JWT_SECRET.trim()
    : 'fetan-dev-fallback-secret-change-in-env';
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${fakeHeader}.${fakePayload}`)
    .digest('base64url');
  assert.equal(
    verifySessionToken(`${fakeHeader}.${fakePayload}.${sig}`),
    null,
    'JWT with alg != HS256 must be rejected'
  );

  const email = `sec-sess-${RUN_TAG}@example.com`;
  const testIp = randomTestIp();
  const initialPass = `OldPass#${RUN_TAG}!`;
  const newPass = `NewPass#${RUN_TAG}!`;
  createdEmails.push(email);
  createdRateKeys.push(
    `login-ip:${testIp}`,
    `login-email:${email}`,
    `reset-ip:${testIp}`,
    `reset-email:${email}`
  );

  const user = await db.createUser({
    email,
    name: `Session User ${RUN_TAG}`,
    passwordHash: await hashPassword(initialPass),
    emailVerified: true,
  });
  createdUserIds.push(user.id);

  // Login sets HttpOnly cookie and omits raw token from JSON body
  const loginRes = await postLogin(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
      body: JSON.stringify({ email, password: initialPass }),
    })
  );
  assert.equal(loginRes.status, 200);
  const loginBody = (await loginRes.json()) as { success: boolean; token?: string };
  assert.equal(loginBody.token, undefined, 'Login JSON must not expose raw HttpOnly JWT');
  const loginSetCookie = loginRes.headers.get('set-cookie') || '';
  assert.ok(loginSetCookie.toLowerCase().includes('httponly'), 'Session cookie must include HttpOnly');
  const oldToken = parseCookieHeader(loginSetCookie.split(',')[0], SESSION_COOKIE_NAME);
  assert.ok(oldToken, 'Login must set fetan_session cookie');

  // Old session is initially accepted
  const beforeResetProfile = await getProfile(
    new Request('http://localhost/api/user/profile', { headers: { cookie: cookieFor(oldToken) } })
  );
  assert.equal(beforeResetProfile.status, 200);

  // Password reset rotates passwordHash & issues new cookie while omitting JSON token
  const resetOtp = await createOtpChallenge({ email, purpose: 'RESET_PASSWORD' });
  const resetRes = await postResetPassword(
    new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
      body: JSON.stringify({ email, code: resetOtp.code, newPassword: newPass }),
    })
  );
  assert.equal(resetRes.status, 200);
  const resetBody = (await resetRes.json()) as { success: boolean; token?: string };
  assert.equal(resetBody.token, undefined, 'Reset-password JSON must not expose raw HttpOnly JWT');
  const resetSetCookie = resetRes.headers.get('set-cookie') || '';
  const newToken = parseCookieHeader(resetSetCookie.split(',')[0], SESSION_COOKIE_NAME);
  assert.ok(newToken && newToken !== oldToken, 'Password reset must issue a fresh session token');

  // Pre-reset cookie is immediately revoked (401)
  const afterResetOld = await getProfile(
    new Request('http://localhost/api/user/profile', { headers: { cookie: cookieFor(oldToken) } })
  );
  assert.equal(afterResetOld.status, 401, 'Pre-reset session cookie must be invalidated after password reset');

  // Post-reset cookie works (200)
  const afterResetNew = await getProfile(
    new Request('http://localhost/api/user/profile', { headers: { cookie: cookieFor(newToken) } })
  );
  assert.equal(afterResetNew.status, 200);
});

test('HIGH-3 & HIGH-4: Asset URLs reject external origins, PDFs serve sandboxed attachments, and HTML escapes special chars', async () => {
  assert.equal(
    escapeHtml(`<script>alert("xss")</script>&'`),
    `&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&#39;`
  );

  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const validCloudPrefix =
    cloudName && !cloudName.startsWith('your_') ? cloudName : 'demo';

  assert.equal(isAllowedPlatformAssetUrl('/api/uploads/file_abc12345'), true);
  assert.equal(
    isAllowedPlatformAssetUrl(`https://res.cloudinary.com/${validCloudPrefix}/image/upload/v1/receipt.png`),
    true
  );
  assert.equal(isAllowedPlatformAssetUrl('https://evil.example/tracker.png'), false);
  assert.equal(isAllowedPlatformAssetUrl('http://res.cloudinary.com/demo/image/upload/a.png'), false);
  assert.equal(isAllowedPlatformAssetUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedPlatformAssetUrl('/api/uploads/../etc/passwd'), false);
  assert.equal(isAllowedCloudinaryUrl('https://evil.example/a.png'), false);

  const email = `sec-asset-${RUN_TAG}@example.com`;
  const testIp = randomTestIp();
  createdEmails.push(email);
  createdRateKeys.push(`kyc:${email}`);

  const user = await db.createUser({
    email,
    name: `Asset User ${RUN_TAG}`,
  });
  createdUserIds.push(user.id);
  createdRateKeys.push(`kyc:${user.id}:${testIp}`);
  const userToken = signSessionToken(user.id, user.role);

  // External https:// URL rejected on KYC submission
  const badKycRes = await postKyc(
    new Request('http://localhost/api/user/kyc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(userToken),
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({
        docType: 'NATIONAL_ID',
        docNumber: 'FAYDA12345',
        docPhotoUrl: 'https://evil.example/ip-grabber.png',
      }),
    })
  );
  assert.equal(badKycRes.status, 400, 'Arbitrary external docPhotoUrl must be rejected');

  // PDF stored in UploadedFile must be served with sandbox CSP and attachment disposition
  const pdfFileId = `pdf-sec-${RUN_TAG}`;
  createdUploadIds.push(pdfFileId);
  await prisma.uploadedFile.create({
    data: {
      id: pdfFileId,
      ownerId: user.id,
      folder: 'kyc',
      filename: 'id-document.pdf',
      mimeType: 'application/pdf',
      size: 16,
      data: Buffer.from('%PDF-1.7\n1 0 obj', 'ascii'),
    },
  });

  const downloadRes = await getUploadById(
    new Request(`http://localhost/api/uploads/${pdfFileId}`, {
      headers: { cookie: cookieFor(userToken) },
    }),
    { params: { id: pdfFileId } }
  );
  assert.equal(downloadRes.status, 200);
  assert.equal(
    downloadRes.headers.get('content-security-policy'),
    "default-src 'none'; sandbox",
    'Served uploads must set sandbox CSP'
  );
  assert.ok(
    (downloadRes.headers.get('content-disposition') || '').startsWith('attachment;'),
    'PDFs must be forced as attachment instead of inline'
  );
});

test('MEDIUM-1 & MEDIUM-2: Offer PATCH enforces limits/balance, getClientIp stops XFF spoofing, and email-relay validates size/JSON/CRLF', async () => {
  const email = `sec-med-${RUN_TAG}@example.com`;
  createdEmails.push(email);

  const merchant = await db.createUser({
    email,
    name: `Merchant ${RUN_TAG}`,
    role: 'MERCHANT',
    kycStatus: 'VERIFIED',
  });
  await db.updateUser(merchant.id, { merchantStatus: 'APPROVED', usdtBalance: 50 });
  createdUserIds.push(merchant.id);
  createdRateKeys.push(`offer-patch:${merchant.id}`);

  const offerId = `ofr-sec-${RUN_TAG}`;
  createdOfferIds.push(offerId);
  await prisma.p2POffer.create({
    data: {
      id: offerId,
      merchantId: merchant.id,
      merchantName: merchant.name,
      offerType: 'SELL',
      pricePerUsdtEtb: 185,
      minLimitEtb: 1000,
      maxLimitEtb: 10000,
      totalAvailable: 25,
      paymentMethods: ['TELEBIRR'],
      terms: 'Fast trade',
    },
  });

  const merchantToken = signSessionToken(merchant.id, merchant.role);

  // Invalid min > max rejected
  const badLimitRes = await patchOfferById(
    new Request(`http://localhost/api/offers/${offerId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(merchantToken),
      },
      body: JSON.stringify({ minLimitEtb: 20000, maxLimitEtb: 5000 }),
    }),
    { params: { id: offerId } }
  );
  assert.equal(badLimitRes.status, 400);

  // SELL totalAvailable > usdtBalance rejected
  const overBalRes = await patchOfferById(
    new Request(`http://localhost/api/offers/${offerId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieFor(merchantToken),
      },
      body: JSON.stringify({ totalAvailable: 500 }),
    }),
    { params: { id: offerId } }
  );
  assert.equal(overBalRes.status, 400);

  // Proxy IP precedence checks
  assert.equal(
    getClientIp(
      new Request('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '1.2.3.4, 203.0.113.9',
          'cf-connecting-ip': '198.51.100.44',
        },
      })
    ),
    '198.51.100.44'
  );
  assert.equal(
    getClientIp(
      new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' },
      })
    ),
    '203.0.113.9'
  );

  // Email relay size cap, JSON error, and CRLF header injection guard
  const prevSecret = process.env.EMAIL_RELAY_SECRET;
  const needTempSecret = !prevSecret && !process.env.JWT_SECRET;
  if (needTempSecret) {
    process.env.EMAIL_RELAY_SECRET = `temp-relay-secret-${RUN_TAG}`;
  }
  try {
    const bigBody = 'x'.repeat(132_000);
    const bigRes = await postEmailRelay(
      new Request('http://localhost/api/internal/email-relay', {
        method: 'POST',
        headers: {
          'x-fetan-timestamp': String(Date.now()),
          'x-fetan-signature': 'ignored',
        },
        body: bigBody,
      })
    );
    assert.equal(bigRes.status, 413);

    const ts = String(Date.now());
    const badJsonBody = '{not-json';
    const badJsonRes = await postEmailRelay(
      new Request('http://localhost/api/internal/email-relay', {
        method: 'POST',
        headers: {
          'x-fetan-timestamp': ts,
          'x-fetan-signature': signEmailRelayPayload(ts, badJsonBody),
        },
        body: badJsonBody,
      })
    );
    assert.equal(badJsonRes.status, 400);

    const crlfBody = JSON.stringify({
      to: 'user@example.com',
      subject: 'Hello\r\nBcc: attacker@evil.com',
      html: '<p>Hi</p>',
    });
    const crlfRes = await postEmailRelay(
      new Request('http://localhost/api/internal/email-relay', {
        method: 'POST',
        headers: {
          'x-fetan-timestamp': ts,
          'x-fetan-signature': signEmailRelayPayload(ts, crlfBody),
        },
        body: crlfBody,
      })
    );
    assert.equal(crlfRes.status, 400);
  } finally {
    if (needTempSecret) {
      delete process.env.EMAIL_RELAY_SECRET;
    }
  }
});
