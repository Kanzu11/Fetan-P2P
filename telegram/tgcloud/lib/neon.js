import { fetch } from 'sdk';

const NEON_SQL_ENDPOINT = 'https://ep-muddy-queen-be7wre2o-pooler.c-9.us-east-2.aws.neon.tech/sql';
const NEON_CONN_STRING =
  'postgresql://neondb_owner:npg_Tr42JLRjqtCQ@ep-muddy-queen-be7wre2o-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require';
const FALLBACK_ADMIN_CHAT_ID = '841403501';

export async function queryNeon(query, params = []) {
  const res = await fetch(NEON_SQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': NEON_CONN_STRING,
    },
    body: JSON.stringify({ query, params }),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Neon SQL non-JSON response (${res.status}): ${raw.slice(0, 180)}`);
  }

  if (!res.ok) {
    throw new Error(data.message || data.error || `Neon SQL HTTP ${res.status}`);
  }

  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    rowCount: Number(data.rowCount || 0),
  };
}

export function normalizeNeonUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    nickname: row.nickname || row.name,
    username: row.telegramHandle || null,
    telegramHandle: row.telegramHandle || null,
    telegramChatId: row.telegramChatId || null,
    telegramNotifications: row.telegramNotifications !== false,
    role: row.role || 'USER',
    isSuspended: Boolean(row.isSuspended),
    suspendReason: row.suspendReason || null,
    kycStatus: row.kycStatus || 'UNVERIFIED',
    kycDocType: row.kycDocType || null,
    kycDocNumber: row.kycDocNumber || null,
    merchantStatus: row.merchantStatus || 'NONE',
    usdtBalance: Number(row.usdtBalance || 0),
    usdtLocked: Number(row.usdtLocked || 0),
    completedTrades: Number(row.completedTrades || 0),
    completionRate: Number(row.completionRate || 100),
    rating: Number(row.rating || 5),
    paymentDetails: row.paymentDetails || {},
  };
}

export async function ensureNeonTelegramUser(tgUser) {
  const rawId = tgUser?.id;
  const tgIdStr = rawId !== undefined && rawId !== null && Number(rawId) > 0 ? String(rawId) : '';
  const cleanUsername = (tgUser?.username || '').replace(/^@/, '').toLowerCase();
  const isSuperTg = cleanUsername === 'kanzedin';
  const fullName =
    [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') ||
    tgUser?.username ||
    (tgIdStr ? `Trader ${tgIdStr}` : 'Guest Trader');

  let row = null;

  if (tgIdStr) {
    const byChat = await queryNeon(
      `SELECT * FROM "User" WHERE "telegramChatId" = $1 LIMIT 1`,
      [tgIdStr]
    );
    row = byChat.rows[0] || null;
  }

  if (!row && isSuperTg) {
    const bySuper = await queryNeon(
      `SELECT * FROM "User" WHERE "role" = 'SUPERADMIN'::"Role" LIMIT 1`
    );
    row = bySuper.rows[0] || null;
  }

  if (!row && cleanUsername) {
    const byHandle = await queryNeon(
      `SELECT * FROM "User" WHERE LOWER("telegramHandle") = $1 LIMIT 1`,
      [`@${cleanUsername}`]
    );
    row = byHandle.rows[0] || null;
  }

  if (row) {
    const needChatUpdate = tgIdStr && row.telegramChatId !== tgIdStr;
    const needHandleUpdate = cleanUsername && !row.telegramHandle;
    if (needChatUpdate || needHandleUpdate) {
      const updated = await queryNeon(
        `UPDATE "User"
         SET "telegramChatId" = COALESCE($1, "telegramChatId"),
             "telegramHandle" = COALESCE($2, "telegramHandle"),
             "updatedAt" = NOW()
         WHERE "id" = $3
         RETURNING *`,
        [tgIdStr || null, cleanUsername ? `@${cleanUsername}` : null, row.id]
      );
      if (updated.rows[0]) row = updated.rows[0];
    }
    return normalizeNeonUser(row);
  }

  if (!tgIdStr) {
    return {
      id: 'usr-tg-guest',
      email: 'guest@telegram.fetan.et',
      name: fullName,
      username: cleanUsername ? `@${cleanUsername}` : null,
      telegramHandle: cleanUsername ? `@${cleanUsername}` : null,
      telegramChatId: null,
      telegramNotifications: true,
      role: isSuperTg ? 'SUPERADMIN' : 'USER',
      isSuspended: false,
      suspendReason: null,
      kycStatus: isSuperTg ? 'VERIFIED' : 'UNVERIFIED',
      merchantStatus: isSuperTg ? 'APPROVED' : 'NONE',
      usdtBalance: 0,
      usdtLocked: 0,
      paymentDetails: {},
    };
  }

  const newId = `usr-tg-${tgIdStr}`;
  const email = `${cleanUsername || tgIdStr}@telegram.fetan.et`;
  const handle = cleanUsername ? `@${cleanUsername}` : null;
  const created = await queryNeon(
    `INSERT INTO "User" (
       "id", "email", "name", "nickname", "telegramHandle", "telegramChatId",
       "telegramNotifications", "authProvider", "emailVerified",
       "role", "kycStatus", "merchantStatus", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       true, 'telegram', false,
       'USER'::"Role", 'UNVERIFIED'::"KycStatus", 'NONE'::"MerchantStatus", NOW()
     )
     ON CONFLICT ("email") DO UPDATE SET
       "telegramChatId" = EXCLUDED."telegramChatId",
       "telegramHandle" = COALESCE("User"."telegramHandle", EXCLUDED."telegramHandle"),
       "updatedAt" = NOW()
     RETURNING *`,
    [newId, email, fullName, cleanUsername || fullName, handle, tgIdStr]
  );
  return normalizeNeonUser(created.rows[0]);
}

export async function getNeonAdminChatIds() {
  const ids = new Set([FALLBACK_ADMIN_CHAT_ID]);
  try {
    const res = await queryNeon(
      `SELECT "telegramChatId" FROM "User" WHERE "role" IN ('ADMIN'::"Role", 'SUPERADMIN'::"Role") AND "telegramChatId" IS NOT NULL`
    );
    for (const r of res.rows) {
      if (r.telegramChatId) ids.add(String(r.telegramChatId).trim());
    }
  } catch {
    // Fallback ID remains in Set
  }
  return Array.from(ids);
}

export function normalizeOfferRow(o) {
  return {
    id: o.id,
    merchantId: o.merchantId,
    merchantName: o.merchantName,
    completedTrades: Number(o.completedTrades || 0),
    completionRate: Number(o.completionRate || 100),
    merchantRating: Number(o.merchantRating || 5),
    avgReleaseTimeMins: Number(o.avgReleaseTimeMins || 2),
    offerType: o.offerType,
    pricePerUsdtEtb: Number(o.pricePerUsdtEtb || 0),
    minLimitEtb: Number(o.minLimitEtb || 0),
    maxLimitEtb: Number(o.maxLimitEtb || 0),
    totalAvailable: Number(o.totalAvailable || 0),
    paymentMethods: Array.isArray(o.paymentMethods) ? o.paymentMethods : [],
    terms: o.terms || '',
    isActive: Boolean(o.isActive),
    isOnline: Boolean(o.isOnline),
    isVerifiedMerchant: Boolean(o.isVerifiedMerchant),
    createdAt: o.createdAt,
  };
}

export function normalizeOrderRow(o) {
  return {
    id: o.id,
    offerId: o.offerId,
    offerType: o.offerType,
    buyerId: o.buyerId,
    buyerName: o.buyerName,
    sellerId: o.sellerId,
    sellerName: o.sellerName,
    usdtAmount: Number(o.usdtAmount || 0),
    etbAmount: Number(o.etbAmount || 0),
    unitPriceEtb: Number(o.unitPriceEtb || 0),
    paymentMethod: o.paymentMethod,
    paymentDetails: o.paymentDetails || {},
    status: o.status,
    proofReceiptUrl: o.proofReceiptUrl || null,
    disputeReason: o.disputeReason || null,
    appealedBy: o.appealedBy || null,
    expiresAt: o.expiresAt,
    paidAt: o.paidAt || null,
    completedAt: o.completedAt || null,
    cancelledAt: o.cancelledAt || null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export function extractSellerPaymentDetails(paymentDetailsJson, method, sellerName) {
  const details = paymentDetailsJson || {};
  const map = {
    TELEBIRR: { key: 'telebirr', hint: 'Open Telebirr app or dial *127#' },
    CBE: { key: 'cbeAccount', holderKey: 'cbeHolder', hint: 'CBE Mobile App or *889#' },
    ABYSSINIA: { key: 'abyssiniaAccount', holderKey: 'abyssiniaHolder', hint: 'BoA Mobile App' },
    AWASH: { key: 'awashAccount', holderKey: 'awashHolder', hint: 'Awash Birr Pro' },
    CBE_BIRR: { key: 'cbeBirr', hint: 'CBE Birr *847#' },
    DASHEN: { key: 'dashenAccount', holderKey: 'dashenHolder', hint: 'Dashen SuperApp' },
  };
  const cfg = map[method] || map.TELEBIRR;
  const accountNumber = details[cfg.key] || 'Shared via order chat';
  const accountName = (cfg.holderKey && details[cfg.holderKey]) || sellerName || 'Fetan Trader';
  return { accountNumber, accountName, hint: cfg.hint };
}

export function makeId(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

export async function createNeonEscrowOrder({ actor, offerId, usdtAmount, paymentMethod }) {
  if (actor.isSuspended) {
    throw new Error(
      actor.suspendReason
        ? `Account suspended: ${actor.suspendReason}`
        : 'Your account is currently suspended.'
    );
  }
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPERADMIN';
  const isVerified = actor.kycStatus === 'VERIFIED' || isAdmin;
  if (!isVerified) {
    throw new Error('Identity verification is required before trading.');
  }
  const amount = Number(usdtAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Specify a valid positive USDT amount.');
  }

  const offRes = await queryNeon(`SELECT * FROM "P2POffer" WHERE "id" = $1 LIMIT 1`, [offerId]);
  const offer = offRes.rows[0];
  if (!offer || !offer.isActive) {
    throw new Error('Offer is no longer active.');
  }
  if (Number(offer.totalAvailable || 0) < amount) {
    throw new Error(`Only ${Number(offer.totalAvailable || 0).toFixed(2)} USDT available on this offer.`);
  }

  const methods = Array.isArray(offer.paymentMethods) && offer.paymentMethods.length > 0
    ? offer.paymentMethods
    : ['TELEBIRR'];
  const chosenMethod = paymentMethod && methods.includes(paymentMethod) ? paymentMethod : methods[0];

  const unitPriceEtb = Number(offer.pricePerUsdtEtb || 0);
  const etbAmount = Number((amount * unitPriceEtb).toFixed(2));
  if (etbAmount < Number(offer.minLimitEtb || 0) || etbAmount > Number(offer.maxLimitEtb || 0)) {
    throw new Error(
      `Order total (${etbAmount.toLocaleString()} ETB) must stay between ${Number(offer.minLimitEtb).toLocaleString()} and ${Number(offer.maxLimitEtb).toLocaleString()} ETB.`
    );
  }

  const buyerId = offer.offerType === 'SELL' ? actor.id : offer.merchantId;
  const sellerId = offer.offerType === 'SELL' ? offer.merchantId : actor.id;
  if (buyerId === sellerId) {
    throw new Error('You cannot trade against your own offer.');
  }

  const usersRes = await queryNeon(
    `SELECT * FROM "User" WHERE "id" IN ($1, $2)`,
    [buyerId, sellerId]
  );
  const buyerRow = usersRes.rows.find((r) => r.id === buyerId);
  const sellerRow = usersRes.rows.find((r) => r.id === sellerId);
  if (!buyerRow || !sellerRow) {
    throw new Error('Trading counterparty account not found.');
  }
  if (buyerRow.isSuspended || sellerRow.isSuspended) {
    throw new Error('This counterparty account is currently suspended.');
  }

  const lockRes = await queryNeon(
    `UPDATE "User"
     SET "usdtBalance" = "usdtBalance" - $1,
         "usdtLocked" = "usdtLocked" + $1,
         "updatedAt" = NOW()
     WHERE "id" = $2 AND "usdtBalance" >= $1
     RETURNING *`,
    [amount, sellerId]
  );
  if (lockRes.rowCount === 0) {
    throw new Error('Seller has insufficient available USDT balance to lock escrow.');
  }

  await queryNeon(
    `UPDATE "P2POffer"
     SET "totalAvailable" = GREATEST(0, "totalAvailable" - $1),
         "isActive" = CASE WHEN "totalAvailable" - $1 <= 0 THEN false ELSE "isActive" END,
         "updatedAt" = NOW()
     WHERE "id" = $2`,
    [amount, offer.id]
  );

  const orderId = makeId('ord');
  const paymentDetails = extractSellerPaymentDetails(
    sellerRow.paymentDetails,
    chosenMethod,
    sellerRow.name
  );

  const insRes = await queryNeon(
    `INSERT INTO "P2POrder" (
       "id", "offerId", "offerType", "buyerId", "buyerName", "sellerId", "sellerName",
       "usdtAmount", "etbAmount", "unitPriceEtb", "paymentMethod", "paymentDetails",
       "status", "expiresAt", "auditLogs", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12::jsonb,
       'PENDING_PAYMENT'::"OrderStatus", NOW() + interval '15 minutes', '[]'::jsonb, NOW()
     ) RETURNING *`,
    [
      orderId,
      offer.id,
      offer.offerType,
      buyerId,
      buyerRow.name,
      sellerId,
      sellerRow.name,
      amount,
      etbAmount,
      unitPriceEtb,
      chosenMethod,
      JSON.stringify(paymentDetails),
    ]
  );

  return {
    order: normalizeOrderRow(insRes.rows[0]),
    buyerChatId: buyerRow.telegramChatId || null,
    sellerChatId: sellerRow.telegramChatId || null,
  };
}

export async function performNeonOrderAction({ actor, orderId, action, reason }) {
  const ordRes = await queryNeon(`SELECT * FROM "P2POrder" WHERE "id" = $1 LIMIT 1`, [orderId]);
  const order = ordRes.rows[0];
  if (!order) {
    throw new Error('Order not found.');
  }
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPERADMIN';
  const amount = Number(order.usdtAmount || 0);

  if (action === 'MARK_PAID') {
    if (order.buyerId !== actor.id) throw new Error('Only the buyer can mark this order paid.');
    const upd = await queryNeon(
      `UPDATE "P2POrder"
       SET "status" = 'PAYMENT_SENT'::"OrderStatus", "paidAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'PENDING_PAYMENT'::"OrderStatus"
       RETURNING *`,
      [orderId]
    );
    if (upd.rowCount === 0) throw new Error('Order is no longer awaiting payment.');
    return normalizeOrderRow(upd.rows[0]);
  }

  if (action === 'RELEASE') {
    if (order.sellerId !== actor.id && !isAdmin) {
      throw new Error('Only the seller or an admin can release escrow.');
    }
    const upd = await queryNeon(
      `UPDATE "P2POrder"
       SET "status" = 'COMPLETED'::"OrderStatus",
           "completedAt" = NOW(),
           "resolvedBy" = $2,
           "resolutionNote" = $3,
           "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" IN ('PAYMENT_SENT'::"OrderStatus", 'DISPUTED'::"OrderStatus")
       RETURNING *`,
      [orderId, isAdmin ? actor.id : null, reason || 'Escrow released']
    );
    if (upd.rowCount === 0) throw new Error('Order must be in PAYMENT_SENT or DISPUTED state to release.');

    await queryNeon(
      `UPDATE "User"
       SET "usdtLocked" = GREATEST(0, "usdtLocked" - $1),
           "completedTrades" = "completedTrades" + 1,
           "updatedAt" = NOW()
       WHERE "id" = $2`,
      [amount, order.sellerId]
    );
    await queryNeon(
      `UPDATE "User"
       SET "usdtBalance" = "usdtBalance" + $1,
           "completedTrades" = "completedTrades" + 1,
           "updatedAt" = NOW()
       WHERE "id" = $2`,
      [amount, order.buyerId]
    );
    return normalizeOrderRow(upd.rows[0]);
  }

  if (action === 'CANCEL') {
    const canBuyerCancel = order.buyerId === actor.id && order.status === 'PENDING_PAYMENT';
    const canAdminCancel = isAdmin && ['PENDING_PAYMENT', 'PAYMENT_SENT', 'DISPUTED'].includes(order.status);
    if (!canBuyerCancel && !canAdminCancel) {
      throw new Error('Only the buyer (before payment) or an admin can cancel this order.');
    }
    const upd = await queryNeon(
      `UPDATE "P2POrder"
       SET "status" = 'CANCELLED'::"OrderStatus",
           "cancelledAt" = NOW(),
           "cancelledBy" = $2,
           "cancelReason" = $3,
           "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" IN ('PENDING_PAYMENT'::"OrderStatus", 'PAYMENT_SENT'::"OrderStatus", 'DISPUTED'::"OrderStatus")
       RETURNING *`,
      [orderId, isAdmin ? 'ADMIN' : 'BUYER', reason || 'Cancelled via Telegram']
    );
    if (upd.rowCount === 0) throw new Error('Order cannot be cancelled in its current state.');

    await queryNeon(
      `UPDATE "User"
       SET "usdtLocked" = GREATEST(0, "usdtLocked" - $1),
           "usdtBalance" = "usdtBalance" + $1,
           "updatedAt" = NOW()
       WHERE "id" = $2`,
      [amount, order.sellerId]
    );
    await queryNeon(
      `UPDATE "P2POffer"
       SET "totalAvailable" = "totalAvailable" + $1,
           "isActive" = true,
           "updatedAt" = NOW()
       WHERE "id" = $2`,
      [amount, order.offerId]
    );
    return normalizeOrderRow(upd.rows[0]);
  }

  if (action === 'DISPUTE') {
    if (order.buyerId !== actor.id && order.sellerId !== actor.id) {
      throw new Error('Only order participants can open a dispute.');
    }
    const appealedBy = order.buyerId === actor.id ? 'BUYER' : 'SELLER';
    const upd = await queryNeon(
      `UPDATE "P2POrder"
       SET "status" = 'DISPUTED'::"OrderStatus",
           "disputeReason" = $2,
           "appealedBy" = $3,
           "appealedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'PAYMENT_SENT'::"OrderStatus"
       RETURNING *`,
      [orderId, reason || 'Dispute opened via Telegram', appealedBy]
    );
    if (upd.rowCount === 0) throw new Error('Disputes can only be opened after payment is marked sent.');
    return normalizeOrderRow(upd.rows[0]);
  }

  throw new Error('Unsupported order action.');
}

export async function reviewNeonKyc({ kycId, approved, reviewerLabel }) {
  const newStatus = approved ? 'VERIFIED' : 'REJECTED';
  const res = await queryNeon(
    `UPDATE "KycSubmission"
     SET "status" = $2::"KycStatus", "reviewedBy" = $3, "reviewedAt" = NOW()
     WHERE "id" = $1
     RETURNING *`,
    [kycId, newStatus, reviewerLabel || 'Fetan Compliance Admin']
  );
  const kyc = res.rows[0];
  if (!kyc) return null;

  const userRes = await queryNeon(
    `UPDATE "User"
     SET "kycStatus" = $2::"KycStatus", "updatedAt" = NOW()
     WHERE "id" = $1
     RETURNING "id", "telegramChatId"`,
    [kyc.userId, newStatus]
  );
  return { kyc, targetChatId: userRes.rows[0]?.telegramChatId || null };
}

export async function reviewNeonMerchant({ applicationId, approved, reviewerLabel }) {
  const newStatus = approved ? 'APPROVED' : 'REJECTED';
  const res = await queryNeon(
    `UPDATE "MerchantApplication"
     SET "status" = $2, "reviewedBy" = $3, "reviewedAt" = NOW()
     WHERE "id" = $1
     RETURNING *`,
    [applicationId, newStatus, reviewerLabel || 'Fetan Admin']
  );
  const app = res.rows[0];
  if (!app) return null;

  if (approved) {
    const userRes = await queryNeon(
      `UPDATE "User"
       SET "merchantStatus" = 'APPROVED'::"MerchantStatus",
           "kycStatus" = 'VERIFIED'::"KycStatus",
           "role" = CASE WHEN "role" IN ('ADMIN'::"Role", 'SUPERADMIN'::"Role") THEN "role" ELSE 'MERCHANT'::"Role" END,
           "updatedAt" = NOW()
       WHERE "id" = $1
       RETURNING "id", "telegramChatId"`,
      [app.userId]
    );
    return { app, targetChatId: userRes.rows[0]?.telegramChatId || null };
  }

  const userRes = await queryNeon(
    `UPDATE "User"
     SET "merchantStatus" = 'REJECTED'::"MerchantStatus", "updatedAt" = NOW()
     WHERE "id" = $1
     RETURNING "id", "telegramChatId"`,
    [app.userId]
  );
  return { app, targetChatId: userRes.rows[0]?.telegramChatId || null };
}

export async function logNeonAudit({ actorId, actorRole, action, targetType, targetId, details }) {
  try {
    await queryNeon(
      `INSERT INTO "AuditLog" ("id", "actorId", "actorRole", "action", "targetType", "targetId", "details")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        makeId('aud'),
        actorId || null,
        actorRole || null,
        action,
        targetType || null,
        targetId || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch {
    // Non-blocking audit insert
  }
}

export async function adminManageUserNeon({ actor, targetUserId, subAction, reason }) {
  const isActorAdmin = actor.role === 'ADMIN' || actor.role === 'SUPERADMIN';
  if (!isActorAdmin) throw new Error('Administrator privileges required.');

  const tRes = await queryNeon(`SELECT * FROM "User" WHERE "id" = $1 LIMIT 1`, [targetUserId]);
  const target = tRes.rows[0];
  if (!target) throw new Error('Target user not found.');
  if (target.role === 'SUPERADMIN') throw new Error('Superadmin account cannot be modified.');

  if (target.id === actor.id && (subAction === 'TOGGLE_SUSPEND' || subAction === 'TOGGLE_ADMIN')) {
    throw new Error('You cannot suspend or demote your own account.');
  }

  let updatedRow = target;
  let auditAction = subAction;

  if (subAction === 'TOGGLE_SUSPEND') {
    if (target.role === 'ADMIN' && actor.role !== 'SUPERADMIN') {
      throw new Error('Only Superadmin can suspend or reactivate an Admin.');
    }
    const nextSuspended = !Boolean(target.isSuspended);
    const suspendReason = nextSuspended
      ? (reason && String(reason).trim().slice(0, 220)) || 'Suspended by Fetan Compliance Admin'
      : null;

    const uRes = await queryNeon(
      `UPDATE "User"
       SET "isSuspended" = $2, "suspendReason" = $3, "updatedAt" = NOW()
       WHERE "id" = $1
       RETURNING *`,
      [target.id, nextSuspended, suspendReason]
    );
    updatedRow = uRes.rows[0] || target;
    if (nextSuspended) {
      await queryNeon(
        `UPDATE "P2POffer" SET "isActive" = false, "updatedAt" = NOW() WHERE "merchantId" = $1`,
        [target.id]
      );
    }
    auditAction = nextSuspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED';
  } else if (subAction === 'TOGGLE_MERCHANT') {
    const currentlyMerchant = target.role === 'MERCHANT' || target.merchantStatus === 'APPROVED';
    const nextMerchant = !currentlyMerchant;
    if (nextMerchant && target.kycStatus !== 'VERIFIED') {
      throw new Error('User must complete KYC verification before becoming a verified merchant.');
    }
    const nextRole =
      target.role === 'ADMIN' || target.role === 'SUPERADMIN'
        ? target.role
        : nextMerchant
        ? 'MERCHANT'
        : 'USER';
    const uRes = await queryNeon(
      `UPDATE "User"
       SET "merchantStatus" = $2::"MerchantStatus", "role" = $3::"Role", "updatedAt" = NOW()
       WHERE "id" = $1
       RETURNING *`,
      [target.id, nextMerchant ? 'APPROVED' : 'NONE', nextRole]
    );
    updatedRow = uRes.rows[0] || target;
    auditAction = nextMerchant ? 'GRANTED_MERCHANT' : 'REVOKED_MERCHANT';
  } else if (subAction === 'VERIFY_KYC' || subAction === 'REJECT_KYC') {
    const nextStatus = subAction === 'VERIFY_KYC' ? 'VERIFIED' : 'REJECTED';
    const uRes = await queryNeon(
      `UPDATE "User" SET "kycStatus" = $2::"KycStatus", "updatedAt" = NOW() WHERE "id" = $1 RETURNING *`,
      [target.id, nextStatus]
    );
    updatedRow = uRes.rows[0] || target;
    auditAction = `KYC_SET_${nextStatus}`;
  } else if (subAction === 'TOGGLE_ADMIN') {
    if (actor.role !== 'SUPERADMIN') {
      throw new Error('Superadmin privileges required to promote or demote Admins.');
    }
    const promote = target.role !== 'ADMIN';
    const isMerch = target.role === 'MERCHANT' || target.merchantStatus === 'APPROVED';
    const nextRole = promote ? 'ADMIN' : isMerch ? 'MERCHANT' : 'USER';
    const uRes = await queryNeon(
      `UPDATE "User" SET "role" = $2::"Role", "updatedAt" = NOW() WHERE "id" = $1 RETURNING *`,
      [target.id, nextRole]
    );
    updatedRow = uRes.rows[0] || target;
    auditAction = promote ? 'PROMOTED_ADMIN' : 'DEMOTED_ADMIN';
  } else {
    throw new Error('Unsupported user management action.');
  }

  await logNeonAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: auditAction,
    targetType: 'User',
    targetId: target.id,
    details: { source: 'TELEGRAM', reason: reason || null },
  });

  return normalizeNeonUser(updatedRow);
}

export async function adminManageOfferNeon({ actor, offerId, subAction }) {
  const isActorAdmin = actor.role === 'ADMIN' || actor.role === 'SUPERADMIN';
  if (!isActorAdmin) throw new Error('Administrator privileges required.');

  const oRes = await queryNeon(`SELECT * FROM "P2POffer" WHERE "id" = $1 LIMIT 1`, [offerId]);
  const offer = oRes.rows[0];
  if (!offer) throw new Error('Ad offer not found.');

  if (subAction === 'TOGGLE_ACTIVE') {
    const nextActive = !Boolean(offer.isActive);
    const uRes = await queryNeon(
      `UPDATE "P2POffer" SET "isActive" = $2, "updatedAt" = NOW() WHERE "id" = $1 RETURNING *`,
      [offerId, nextActive]
    );
    await logNeonAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: nextActive ? 'OFFER_ACTIVATED' : 'OFFER_PAUSED',
      targetType: 'P2POffer',
      targetId: offerId,
      details: { source: 'TELEGRAM' },
    });
    return normalizeOfferRow(uRes.rows[0] || offer);
  }

  if (subAction === 'DELETE') {
    const openRes = await queryNeon(
      `SELECT COUNT(*)::int AS c FROM "P2POrder"
       WHERE "offerId" = $1 AND "status" IN ('PENDING_PAYMENT'::"OrderStatus", 'PAYMENT_SENT'::"OrderStatus", 'DISPUTED'::"OrderStatus")`,
      [offerId]
    );
    if (Number(openRes.rows[0]?.c || 0) > 0) {
      throw new Error('Cannot delete an ad with active open orders. Complete or cancel them first.');
    }

    let archived = false;
    try {
      await queryNeon(`DELETE FROM "P2POffer" WHERE "id" = $1`, [offerId]);
    } catch {
      archived = true;
      await queryNeon(
        `UPDATE "P2POffer" SET "isActive" = false, "totalAvailable" = 0, "updatedAt" = NOW() WHERE "id" = $1`,
        [offerId]
      );
    }

    await logNeonAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: archived ? 'OFFER_ARCHIVED' : 'OFFER_DELETED',
      targetType: 'P2POffer',
      targetId: offerId,
      details: { source: 'TELEGRAM' },
    });
    return { deleted: !archived, archived, id: offerId };
  }

  throw new Error('Unsupported offer management action.');
}

export async function adminReviewWithdrawalNeon({ actor, txId, approved, txHash, note }) {
  const isActorAdmin = actor.role === 'ADMIN' || actor.role === 'SUPERADMIN';
  if (!isActorAdmin) throw new Error('Administrator privileges required.');

  const tRes = await queryNeon(
    `SELECT * FROM "WalletTransaction" WHERE "id" = $1 AND "type" = 'WITHDRAW' LIMIT 1`,
    [txId]
  );
  const existing = tRes.rows[0];
  if (!existing) throw new Error('Withdrawal request not found.');
  if (existing.status !== 'PENDING') {
    throw new Error(`Withdrawal is already ${existing.status}.`);
  }

  const cleanHash = txHash ? String(txHash).trim() : '';
  if (approved && cleanHash.length < 16) {
    throw new Error('Valid payout blockchain TxHash is required to approve withdrawal.');
  }

  const nextStatus = approved ? 'COMPLETED' : 'REJECTED';
  const cleanNote =
    (note && String(note).trim().slice(0, 240)) ||
    (approved
      ? `Approved and dispatched by ${actor.name} via Telegram Admin`
      : `Rejected and refunded to wallet by ${actor.name} via Telegram Admin`);

  const updTx = await queryNeon(
    `UPDATE "WalletTransaction"
     SET "status" = $2::"WalletTxStatus",
         "txHash" = CASE WHEN $3 <> '' THEN $3 ELSE "txHash" END,
         "reviewedBy" = $4,
         "note" = $5,
         "updatedAt" = NOW()
     WHERE "id" = $1 AND "status" = 'PENDING'::"WalletTxStatus"
     RETURNING *`,
    [txId, nextStatus, approved ? cleanHash : '', actor.id, cleanNote]
  );
  if (updTx.rowCount === 0) throw new Error('Withdrawal has already been processed.');

  if (!approved) {
    await queryNeon(
      `UPDATE "User" SET "usdtBalance" = "usdtBalance" + $2, "updatedAt" = NOW() WHERE "id" = $1`,
      [existing.userId, Number(existing.amount || 0)]
    );
  }

  const uRes = await queryNeon(`SELECT "telegramChatId" FROM "User" WHERE "id" = $1 LIMIT 1`, [
    existing.userId,
  ]);
  await logNeonAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: approved ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
    targetType: 'WalletTransaction',
    targetId: txId,
    details: { source: 'TELEGRAM', amount: Number(existing.amount || 0), txHash: approved ? cleanHash : null },
  });

  return {
    tx: {
      ...updTx.rows[0],
      amount: Number(updTx.rows[0]?.amount || existing.amount || 0),
    },
    targetChatId: uRes.rows[0]?.telegramChatId || null,
  };
}

