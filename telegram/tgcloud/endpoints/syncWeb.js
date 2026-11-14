import { db, eq } from 'sdk/db';
import { users, orders, kycSubmissions, merchantApplications, supportTickets } from '../schema.js';

export default async function (input, ctx) {
  const { action, payload } = input || {};

  if (action === 'UPSERT_USER' && payload?.user) {
    const u = payload.user;
    const existing = await db.select().from(users).where(eq(users.id, u.id)).get();
    if (existing) {
      await db.update(users).set({
        name: u.name,
        username: u.telegramHandle,
        email: u.email,
        role: u.role,
        kycStatus: u.kycStatus,
        kycDocType: u.kycDocType,
        kycDocNumber: u.kycDocNumber,
        usdtBalance: u.usdtBalance,
        usdtLocked: u.usdtLocked,
        notifications: u.telegramNotifications !== false,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, u.id)).run();
    } else {
      await db.insert(users).values({
        id: u.id,
        name: u.name,
        username: u.telegramHandle,
        email: u.email,
        role: u.role,
        kycStatus: u.kycStatus,
        kycDocType: u.kycDocType,
        kycDocNumber: u.kycDocNumber,
        usdtBalance: u.usdtBalance || 0,
        usdtLocked: u.usdtLocked || 0,
        notifications: u.telegramNotifications !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
    }
    return { ok: true, synced: 'user' };
  }

  if (action === 'UPSERT_ORDER' && payload?.order) {
    const o = payload.order;
    const existing = await db.select().from(orders).where(eq(orders.id, o.id)).get();
    if (existing) {
      await db.update(orders).set({
        status: o.status,
        proofReceiptUrl: o.proofReceiptUrl || null,
        disputeReason: o.disputeReason || null,
        updatedAt: new Date().toISOString(),
      }).where(eq(orders.id, o.id)).run();
    } else {
      await db.insert(orders).values({
        id: o.id,
        offerId: o.offerId,
        buyerId: o.buyerId,
        buyerName: o.buyerName,
        sellerId: o.sellerId,
        sellerName: o.sellerName,
        usdtAmount: o.usdtAmount,
        etbAmount: o.etbAmount,
        unitPriceEtb: o.unitPriceEtb,
        paymentMethod: o.paymentMethod,
        status: o.status,
        proofReceiptUrl: o.proofReceiptUrl || null,
        disputeReason: o.disputeReason || null,
        createdAt: o.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
    }
    return { ok: true, synced: 'order' };
  }

  if (action === 'UPSERT_KYC' && payload?.kyc) {
    const k = payload.kyc;
    const existing = await db.select().from(kycSubmissions).where(eq(kycSubmissions.id, k.id)).get();
    if (existing) {
      await db.update(kycSubmissions).set({
        status: k.status,
      }).where(eq(kycSubmissions.id, k.id)).run();
    } else {
      await db.insert(kycSubmissions).values({
        id: k.id,
        userId: k.userId,
        userName: k.userName,
        userEmail: k.userEmail,
        docType: k.kycDocType,
        docNumber: k.kycDocNumber,
        status: k.status,
        submittedAt: k.submittedAt,
      }).run();
    }
    if (k.userId) {
      const localUser = await db.select().from(users).where(eq(users.id, k.userId)).get();
      if (localUser) {
        await db.update(users).set({ kycStatus: k.status }).where(eq(users.id, k.userId)).run();
      }
    }
    return { ok: true, synced: 'kyc' };
  }

  if (action === 'UPSERT_MERCHANT_APP' && payload?.app) {
    const a = payload.app;
    const existing = await db.select().from(merchantApplications).where(eq(merchantApplications.id, a.id)).get();
    if (existing) {
      await db.update(merchantApplications).set({
        status: a.status,
      }).where(eq(merchantApplications.id, a.id)).run();
    } else {
      await db.insert(merchantApplications).values({
        id: a.id,
        userId: a.userId,
        userName: a.userName,
        userEmail: a.userEmail,
        usdtBalance: Number(a.usdtBalance || 0),
        status: a.status,
        submittedAt: a.submittedAt,
      }).run();
    }
    if (a.userId && a.status === 'APPROVED') {
      const localUser = await db.select().from(users).where(eq(users.id, a.userId)).get();
      if (localUser) {
        await db.update(users).set({
          role: localUser.role === 'ADMIN' || localUser.role === 'SUPERADMIN' ? localUser.role : 'MERCHANT',
          kycStatus: 'VERIFIED',
        }).where(eq(users.id, a.userId)).run();
      }
    }
    return { ok: true, synced: 'merchant_app' };
  }

  if (action === 'UPSERT_TICKET' && payload?.ticket) {
    const t = payload.ticket;
    const existing = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id)).get();
    if (existing) {
      await db.update(supportTickets).set({
        status: t.status,
        adminReply: t.adminReply || null,
      }).where(eq(supportTickets.id, t.id)).run();
    } else {
      await db.insert(supportTickets).values({
        id: t.id,
        userId: t.userId,
        userName: t.userName,
        orderId: t.orderId,
        category: t.category,
        subject: t.subject,
        message: t.message,
        status: t.status,
        adminReply: t.adminReply || null,
        createdAt: t.createdAt,
      }).run();
    }
    return { ok: true, synced: 'ticket' };
  }

  return { ok: true };
}
