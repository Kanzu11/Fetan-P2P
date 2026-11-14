import { db, eq } from 'sdk/db';
import { api, EndpointError } from 'sdk';
import { users, kycSubmissions } from '../schema.js';
import {
  ensureNeonTelegramUser,
  queryNeon,
  getNeonAdminChatIds,
  makeId,
} from '../lib/neon.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user || input?.user;
  if (!tgUser?.id) {
    throw new EndpointError('Authentication required via Telegram Mini App', { code: 'UNAUTHORIZED' });
  }

  const { docType, docNumber, docPhotoUrl } = input || {};
  if (!docNumber || !docNumber.trim()) {
    throw new EndpointError('Please enter your valid ID number', { code: 'INVALID_ID' });
  }

  const user = await ensureNeonTelegramUser(tgUser);
  const cleanDocNumber = docNumber.trim();
  const cleanDocType = docType || 'NATIONAL_ID';
  const subId = makeId('kyc-miniapp');

  await queryNeon(
    `INSERT INTO "KycSubmission" (
       "id", "userId", "userEmail", "userName", "telegramHandle",
       "source", "kycDocType", "kycDocNumber", "docPhotoUrl", "status", "submittedAt"
     ) VALUES (
       $1, $2, $3, $4, $5,
       'MINI_APP', $6, $7, $8, 'PENDING'::"KycStatus", NOW()
     )`,
    [
      subId,
      user.id,
      user.email,
      user.name,
      user.telegramHandle || null,
      cleanDocType,
      cleanDocNumber,
      docPhotoUrl || null,
    ]
  );

  await queryNeon(
    `UPDATE "User"
     SET "kycStatus" = 'PENDING'::"KycStatus",
         "kycDocType" = $2,
         "kycDocNumber" = $3,
         "kycSubmittedAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [user.id, cleanDocType, cleanDocNumber]
  );

  // Best-effort mirror to local TGCloud SQLite
  try {
      await db.insert(kycSubmissions).values({
        id: subId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        docType: cleanDocType,
        docNumber: cleanDocNumber,
        status: 'PENDING',
        submittedAt: new Date().toISOString(),
      }).run();
      const localUser = await db.select().from(users).where(eq(users.id, user.id)).get();
      if (localUser) {
        await db.update(users).set({
          kycStatus: 'PENDING',
          kycDocType: cleanDocType,
          kycDocNumber: cleanDocNumber,
        }).where(eq(users.id, user.id)).run();
      }
  } catch { }

  // Alert all platform admins on Telegram Bot with inline review buttons
  const adminChatIds = await getNeonAdminChatIds();
  const alertText =
    `🪪 <b>NEW KYC VERIFICATION via Mini App</b>\n\n` +
    `• User: <b>${user.name}</b> (${user.telegramHandle || user.email})\n` +
    `• ID Type: <b>${cleanDocType}</b>\n` +
    `• ID Number: <code>${cleanDocNumber}</code>`;

  for (const admId of adminChatIds) {
    await api.sendMessage({
      chat_id: admId,
      parse_mode: 'HTML',
      text: alertText,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve KYC', callback_data: `kyc_approve:${subId}` },
          { text: '❌ Reject KYC', callback_data: `kyc_reject:${subId}` },
        ]],
      },
    }).catch(() => { });
  }

  return { ok: true, id: subId, status: 'PENDING', message: 'ID submitted for review by Fetan Compliance Desk' };
}
