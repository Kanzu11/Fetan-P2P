import { db, eq } from 'sdk/db';
import { api, EndpointError } from 'sdk';
import { users, kycSubmissions } from '../schema.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user || input?.user;
  if (!tgUser?.id) {
    throw new EndpointError('Authentication required via Telegram Mini App', { code: 'UNAUTHORIZED' });
  }

  const { docType, docNumber } = input || {};
  if (!docNumber || !docNumber.trim()) {
    throw new EndpointError('Please enter your valid ID number', { code: 'INVALID_ID' });
  }

  let user = await db.select().from(users).where(eq(users.tgId, tgUser.id)).get();
  if (!user) {
    user = {
      id: `usr-tg-${tgUser.id}`,
      tgId: tgUser.id,
      name: tgUser.first_name || 'Trader',
      username: tgUser.username ? `@${tgUser.username}` : null,
      role: 'USER',
      kycStatus: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    await db.insert(users).values(user).run();
  }

  const subId = `kyc-miniapp-${Date.now()}`;
  await db.insert(kycSubmissions).values({
    id: subId,
    userId: user.id,
    userName: user.name,
    userEmail: user.email || `${tgUser.id}@telegram.fetan.et`,
    docType: docType || 'NATIONAL_ID',
    docNumber: docNumber.trim(),
    status: 'PENDING',
    submittedAt: new Date().toISOString(),
  }).run();

  await db.update(users).set({
    kycStatus: 'PENDING',
    kycDocType: docType || 'NATIONAL_ID',
    kycDocNumber: docNumber.trim(),
  }).where(eq(users.id, user.id)).run();

  // Notify Superadmin @kanzedin
  try {
    const superUser = await db.select().from(users).where(eq(users.role, 'SUPERADMIN')).get();
    if (superUser && superUser.tgId) {
      await api.sendMessage({
        chat_id: superUser.tgId,
        parse_mode: 'HTML',
        text: `🪪 <b>NEW KYC VERIFICATION via Mini App</b>\n\n• User: <b>${user.name}</b> (${user.username || user.id})\n• ID Type: <b>${docType || 'NATIONAL_ID'}</b>\n• ID Number: <code>${docNumber.trim()}</code>`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve KYC', callback_data: `kyc_approve:${subId}` },
              { text: '❌ Reject KYC', callback_data: `kyc_reject:${subId}` },
            ],
          ],
        },
      });
    }
  } catch {}

  return { ok: true, status: 'PENDING', message: 'ID submitted for review by Superadmin @kanzedin' };
}
