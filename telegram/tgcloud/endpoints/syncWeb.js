import { db, eq } from 'sdk/db';
import { EndpointError } from 'sdk';
import {
  users,
  orders,
  kycSubmissions,
  merchantApplications,
  supportTickets,
  kvConfig,
} from '../schema.js';

async function upsertKvConfig(key, value) {
  const existing = await db.select().from(kvConfig).where(eq(kvConfig.key, key)).get();
  const now = new Date().toISOString();
  if (existing) {
    await db.update(kvConfig).set({ value, updatedAt: now }).where(eq(kvConfig.key, key)).run();
  } else {
    await db.insert(kvConfig).values({ key, value, updatedAt: now }).run();
  }
}

export function safeEqual(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  const maxLen = Math.max(strA.length, strB.length);
  let diff = strA.length ^ strB.length;
  for (let i = 0; i < maxLen; i += 1) {
    const ca = i < strA.length ? strA.charCodeAt(i) : 0;
    const cb = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0 && strA.length > 0;
}

export function parseNeonDatabaseUrl(rawUrl, explicitEndpoint) {
  const cleaned = String(rawUrl || '').trim();
  if (!/^postgres(?:ql)?:\/\//i.test(cleaned)) {
    throw new Error('Invalid DATABASE_URL protocol');
  }
  const hostMatch = cleaned.match(/@([^/?:]+)/);
  if (!hostMatch) {
    throw new Error('Invalid DATABASE_URL host');
  }
  const host = hostMatch[1].trim().toLowerCase();
  if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new Error('Database host must be a valid multi-label hostname');
  }
  const sqlEndpoint = (explicitEndpoint || `https://${host}/sql`).trim();
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(sqlEndpoint);
  } catch {
    throw new Error('Invalid SQL endpoint URL');
  }
  if (
    parsedEndpoint.protocol !== 'https:' ||
    parsedEndpoint.hostname.toLowerCase() !== host ||
    parsedEndpoint.pathname !== '/sql'
  ) {
    throw new Error('SQL endpoint must use HTTPS /sql on the matching database host');
  }
  // Strip libpq-only channel_binding param for HTTP SQL endpoint compatibility
  const connString = cleaned
    .replace(/([?&])channel_binding=[^&]*&?/g, '$1')
    .replace(/[?&]$/, '');
  return { sqlEndpoint, connString, host };
}

export default async function (input, ctx) {
  // Block Mini App client callers — only authenticated backend sync may invoke this endpoint
  if (ctx?.initData?.user) {
    throw new EndpointError('Forbidden', { code: 'FORBIDDEN' });
  }

  const envSyncSecret =
    typeof process !== 'undefined' && process.env?.TELEGRAM_SYNC_SECRET
      ? String(process.env.TELEGRAM_SYNC_SECRET).trim()
      : '';
  let expectedSecret = envSyncSecret;
  if (!expectedSecret) {
    const storedSecret = await db.select().from(kvConfig).where(eq(kvConfig.key, 'telegram_sync_secret')).get();
    expectedSecret = String(storedSecret?.value || '').trim();
  }
  if (!expectedSecret) {
    throw new EndpointError('Sync secret not configured on TGCloud', { code: 'UNAUTHORIZED' });
  }

  const headerSecret =
    ctx?.headers?.['x-telegram-sync-secret'] ||
    ctx?.headers?.['X-Telegram-Sync-Secret'] ||
    '';
  const providedSecret = String(input?.syncSecret || headerSecret || '').trim();
  if (!safeEqual(providedSecret, expectedSecret)) {
    throw new EndpointError('Unauthorized sync request', { code: 'UNAUTHORIZED' });
  }

  const { action, payload } = input || {};

  if (action === 'SET_NEON_CONFIG' && (payload?.databaseUrl || payload?.connString)) {
    const { sqlEndpoint, connString, host } = parseNeonDatabaseUrl(
      payload.databaseUrl || payload.connString,
      payload.sqlEndpoint
    );
    await upsertKvConfig('neon_conn_string', connString);
    await upsertKvConfig('neon_sql_endpoint', sqlEndpoint);
    return { ok: true, synced: 'neon_config', host };
  }

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
