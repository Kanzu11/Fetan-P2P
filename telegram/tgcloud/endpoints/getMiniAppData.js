import { db, eq } from 'sdk/db';
import { users, orders, kycSubmissions, supportTickets } from '../schema.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user || input?.user || {};
  const tgId = tgUser.id;
  const username = (tgUser.username || '').replace(/^@/, '').toLowerCase();
  const isSuperadmin = username === 'kanzedin';

  let user = null;
  if (tgId) {
    user = await db.select().from(users).where(eq(users.tgId, tgId)).get();
  }

  // Get active orders
  const allOrders = await db.select().from(orders).all();
  const userOrders = allOrders.filter(
    (o) => (user && (o.buyerId === user.id || o.sellerId === user.id)) || isSuperadmin
  );

  // If superadmin, return stats
  let adminStats = null;
  if (isSuperadmin) {
    const kycs = await db.select().from(kycSubmissions).all();
    const tickets = await db.select().from(supportTickets).all();
    adminStats = {
      pendingKycs: kycs.filter((k) => k.status === 'PENDING').length,
      openDisputes: allOrders.filter((o) => o.status === 'DISPUTED').length,
      openTickets: tickets.filter((t) => t.status === 'OPEN').length,
    };
  }

  return {
    ok: true,
    user: user || {
      id: `usr-tg-${tgId || 'guest'}`,
      name: tgUser.first_name || 'Guest Trader',
      username: username ? `@${username}` : null,
      role: isSuperadmin ? 'SUPERADMIN' : 'USER',
      kycStatus: isSuperadmin ? 'VERIFIED' : 'UNVERIFIED',
      usdtBalance: isSuperadmin ? 5000 : 0,
      usdtLocked: 0,
    },
    isSuperadmin,
    adminStats,
    orders: userOrders.slice(0, 15),
    marketStats: {
      usdtBuyPrice: 158.35,
      usdtSellPrice: 157.40,
      methods: ['Telebirr', 'CBE', 'Abyssinia', 'Awash', 'Dashen'],
    },
  };
}
