import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import {
  User,
  P2POffer,
  P2POrder,
  MerchantApplication,
  KycSubmission,
  ChatMessage,
  PaymentMethod,
  SupportTicket,
  WalletTransaction,
  OrderAuditLog,
  OrderFeedback,
  UserPaymentDetails,
  KycDocType,
  OPEN_ORDER_STATUSES,
} from '../../client/types';
import { generateUserDepositAddresses } from '../crypto-address-service';

type DbClient = typeof prisma | Prisma.TransactionClient;

const txStorage = new AsyncLocalStorage<Prisma.TransactionClient>();

function toIso(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

function mapUser(row: {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  telegramHandle: string | null;
  telegramChatId: string | null;
  telegramNotifications: boolean;
  telegramLinkCode: string | null;
  role: 'USER' | 'MERCHANT' | 'ADMIN' | 'SUPERADMIN';
  kycStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  kycDocType: string | null;
  kycDocNumber: string | null;
  kycSubmittedAt: Date | null;
  merchantStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  usdtBalance: Prisma.Decimal;
  usdtLocked: Prisma.Decimal;
  paymentDetails: Prisma.JsonValue | null;
  depositAddresses: Prisma.JsonValue | null;
  completedTrades: number;
  completionRate: number;
  avgReleaseTimeMins: number;
  rating: number;
  positiveFeedback: number;
  negativeFeedback: number;
  createdAt: Date;
  updatedAt: Date;
}): User {
  const derivedAddresses =
    (row.depositAddresses as User['depositAddresses'] | null) ||
    generateUserDepositAddresses(row.id);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    nickname: row.nickname || undefined,
    phone: row.phone || undefined,
    telegramHandle: row.telegramHandle || undefined,
    telegramChatId: row.telegramChatId || undefined,
    telegramNotifications: row.telegramNotifications,
    telegramLinkCode: row.telegramLinkCode || undefined,
    role: row.role,
    kycStatus: row.kycStatus,
    kycDocType: (row.kycDocType as KycDocType) || undefined,
    kycDocNumber: row.kycDocNumber || undefined,
    kycSubmittedAt: toIso(row.kycSubmittedAt),
    merchantStatus: row.merchantStatus,
    usdtBalance: Number(row.usdtBalance),
    usdtLocked: Number(row.usdtLocked),
    paymentDetails: (row.paymentDetails as UserPaymentDetails) || undefined,
    depositAddresses: derivedAddresses || undefined,
    completedTrades: row.completedTrades,
    completionRate: row.completionRate,
    avgReleaseTimeMins: row.avgReleaseTimeMins,
    rating: row.rating,
    positiveFeedback: row.positiveFeedback,
    negativeFeedback: row.negativeFeedback,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapOffer(row: {
  id: string;
  merchantId: string;
  merchantName: string;
  completedTrades: number;
  completionRate: number;
  merchantRating: number;
  avgReleaseTimeMins: number;
  offerType: string;
  pricePerUsdtEtb: Prisma.Decimal;
  minLimitEtb: Prisma.Decimal;
  maxLimitEtb: Prisma.Decimal;
  totalAvailable: Prisma.Decimal;
  paymentMethods: string[];
  terms: string | null;
  isActive: boolean;
  isOnline: boolean;
  isVerifiedMerchant: boolean;
  createdAt: Date;
}): P2POffer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    completedTrades: row.completedTrades,
    completionRate: row.completionRate,
    merchantRating: row.merchantRating,
    avgReleaseTimeMins: row.avgReleaseTimeMins,
    offerType: row.offerType as 'SELL' | 'BUY',
    pricePerUsdtEtb: Number(row.pricePerUsdtEtb),
    minLimitEtb: Number(row.minLimitEtb),
    maxLimitEtb: Number(row.maxLimitEtb),
    totalAvailable: Number(row.totalAvailable),
    paymentMethods: row.paymentMethods as PaymentMethod[],
    terms: row.terms || undefined,
    isActive: row.isActive,
    isOnline: row.isOnline,
    isVerifiedMerchant: row.isVerifiedMerchant,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapOrder(row: {
  id: string;
  offerId: string;
  offerType: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  usdtAmount: Prisma.Decimal;
  etbAmount: Prisma.Decimal;
  unitPriceEtb: Prisma.Decimal;
  status: 'PENDING_PAYMENT' | 'PAYMENT_SENT' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED';
  paymentMethod: string;
  paymentDetails: Prisma.JsonValue;
  proofReceiptUrl: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  autoReleaseAt: Date | null;
  isAutoRelease: boolean;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  disputeReason: string | null;
  appealedBy: string | null;
  appealedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  buyerFeedback: Prisma.JsonValue | null;
  sellerFeedback: Prisma.JsonValue | null;
  auditLogs: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): P2POrder {
  return {
    id: row.id,
    offerId: row.offerId,
    offerType: row.offerType as 'SELL' | 'BUY',
    buyerId: row.buyerId,
    buyerName: row.buyerName,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    usdtAmount: Number(row.usdtAmount),
    etbAmount: Number(row.etbAmount),
    unitPriceEtb: Number(row.unitPriceEtb),
    status: row.status,
    paymentMethod: row.paymentMethod as PaymentMethod,
    paymentDetails: row.paymentDetails as P2POrder['paymentDetails'],
    proofReceiptUrl: row.proofReceiptUrl || undefined,
    expiresAt: row.expiresAt.toISOString(),
    paidAt: toIso(row.paidAt),
    autoReleaseAt: toIso(row.autoReleaseAt),
    isAutoRelease: row.isAutoRelease,
    completedAt: toIso(row.completedAt),
    cancelledAt: toIso(row.cancelledAt),
    cancelledBy: row.cancelledBy || undefined,
    cancelReason: row.cancelReason || undefined,
    disputeReason: row.disputeReason || undefined,
    appealedBy: row.appealedBy || undefined,
    appealedAt: toIso(row.appealedAt),
    resolvedBy: row.resolvedBy || undefined,
    resolutionNote: row.resolutionNote || undefined,
    buyerFeedback: (row.buyerFeedback as OrderFeedback | null) || undefined,
    sellerFeedback: (row.sellerFeedback as OrderFeedback | null) || undefined,
    auditLogs: Array.isArray(row.auditLogs) ? (row.auditLogs as unknown as OrderAuditLog[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapChat(row: {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  text: string;
  imageUrl: string | null;
  type: string;
  isSystem: boolean;
  timestamp: Date;
}): ChatMessage {
  return {
    id: row.id,
    orderId: row.orderId,
    senderId: row.senderId,
    senderName: row.senderName,
    senderRole: row.senderRole as ChatMessage['senderRole'],
    text: row.text,
    imageUrl: row.imageUrl || undefined,
    type: (row.type as 'TEXT' | 'IMAGE') || 'TEXT',
    isSystem: row.isSystem,
    timestamp: row.timestamp.toISOString(),
  };
}

function mapKyc(row: {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  telegramHandle: string | null;
  source: string;
  kycDocType: string;
  kycDocNumber: string;
  docPhotoUrl: string | null;
  status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  submittedAt: Date;
  reviewedBy: string | null;
}): KycSubmission {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    telegramHandle: row.telegramHandle || undefined,
    source: row.source as KycSubmission['source'],
    kycDocType: row.kycDocType as KycDocType,
    kycDocNumber: row.kycDocNumber,
    docPhotoUrl: row.docPhotoUrl || undefined,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewedBy: row.reviewedBy || undefined,
  };
}

function mapMerchantApp(row: {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  businessName: string | null;
  telegramHandle: string;
  kycDocType: string;
  kycDocNumber: string;
  proofDocumentUrl: string | null;
  usdtBalance: Prisma.Decimal;
  tradeExperience: string | null;
  terms: string | null;
  status: string;
  submittedAt: Date;
  reviewedBy: string | null;
}): MerchantApplication {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    businessName: row.businessName || undefined,
    telegramHandle: row.telegramHandle,
    kycDocType: row.kycDocType as KycDocType,
    kycDocNumber: row.kycDocNumber,
    proofDocumentUrl: row.proofDocumentUrl || undefined,
    usdtBalance: Number(row.usdtBalance),
    tradeExperience: row.tradeExperience || undefined,
    terms: row.terms || undefined,
    status: row.status as MerchantApplication['status'],
    submittedAt: row.submittedAt.toISOString(),
    reviewedBy: row.reviewedBy || undefined,
  };
}

function mapTicket(row: {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  telegramHandle: string | null;
  orderId: string | null;
  category: string;
  subject: string;
  message: string;
  status: string;
  adminReply: string | null;
  resolvedBy: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}): SupportTicket {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    telegramHandle: row.telegramHandle || undefined,
    orderId: row.orderId || undefined,
    category: row.category as SupportTicket['category'],
    subject: row.subject,
    message: row.message,
    status: row.status as SupportTicket['status'],
    adminReply: row.adminReply || undefined,
    resolvedBy: row.resolvedBy || undefined,
    source: row.source as SupportTicket['source'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWalletTx(row: {
  id: string;
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  amount: Prisma.Decimal;
  network: string;
  txHash: string | null;
  address: string | null;
  status: 'COMPLETED' | 'PENDING' | 'REJECTED';
  createdAt: Date;
  note: string | null;
}): WalletTransaction {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    amount: Number(row.amount),
    network: row.network as WalletTransaction['network'],
    txHash: row.txHash || undefined,
    address: row.address || undefined,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    note: row.note || undefined,
  };
}

export class DatabaseStore {
  private bootstrapped = false;
  private bootstrapPromise: Promise<void> | null = null;

  private client(): DbClient {
    return txStorage.getStore() || prisma;
  }

  /**
   * Ensures the platform superadmin account configured via SUPERADMIN_EMAIL exists in PostgreSQL.
   * No dummy users, fake merchants, or fake orders are ever created.
   */
  async ensureBootstrapped(): Promise<void> {
    if (this.bootstrapped) return;
    if (this.bootstrapPromise) return this.bootstrapPromise;

    this.bootstrapPromise = (async () => {
      try {
        const superAdminEmail = (
          process.env.SUPERADMIN_EMAIL ||
          process.env.ADMIN_EMAIL ||
          ''
        )
          .trim()
          .toLowerCase();

        if (superAdminEmail) {
          const existing = await prisma.user.findUnique({ where: { email: superAdminEmail } });
          if (!existing) {
            const id = `usr-super-${Date.now().toString(36)}`;
            const superTg = (process.env.ADMIN_TELEGRAM_USERNAME || '').replace(/^@/, '');
            await prisma.user.create({
              data: {
                id,
                email: superAdminEmail,
                name: 'Platform Superadmin',
                nickname: 'Superadmin',
                telegramHandle: superTg ? `@${superTg}` : null,
                telegramNotifications: true,
                telegramLinkCode: `FETAN-SA-${Math.floor(1000 + Math.random() * 9000)}`,
                role: 'SUPERADMIN',
                kycStatus: 'VERIFIED',
                merchantStatus: 'APPROVED',
                emailVerified: true,
                authProvider: 'email',
                depositAddresses: generateUserDepositAddresses(id) as unknown as Prisma.InputJsonValue,
              },
            });
          } else if (existing.role !== 'SUPERADMIN') {
            await prisma.user.update({
              where: { id: existing.id },
              data: { role: 'SUPERADMIN', kycStatus: 'VERIFIED' },
            });
          }
        }
        this.bootstrapped = true;
      } catch (err) {
        console.warn('Bootstrap notice:', err instanceof Error ? err.message : err);
      } finally {
        this.bootstrapPromise = null;
      }
    })();

    return this.bootstrapPromise;
  }

  // ---------- Transactions & Row Locks (PostgreSQL SELECT ... FOR UPDATE) ----------

  async withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    await this.ensureBootstrapped();
    const existingTx = txStorage.getStore();
    if (existingTx) {
      return fn();
    }

    const sortedKeys = Array.from(new Set(keys)).sort();

    return prisma.$transaction(
      async (tx) => {
        for (const key of sortedKeys) {
          const [kind, id] = key.split(':');
          if (!id) continue;
          if (kind === 'user') {
            await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
          } else if (kind === 'order') {
            await tx.$executeRaw`SELECT "id" FROM "P2POrder" WHERE "id" = ${id} FOR UPDATE`;
          } else if (kind === 'offer') {
            await tx.$executeRaw`SELECT "id" FROM "P2POffer" WHERE "id" = ${id} FOR UPDATE`;
          }
        }
        return txStorage.run(tx, fn);
      },
      { maxWait: 15000, timeout: 60000 }
    );
  }

  async withUserLock<T>(userId: string, fn: (user: User) => Promise<T>): Promise<T> {
    return this.withLocks([`user:${userId}`], async () => {
      const user = await this.getUser(userId);
      if (!user) throw new Error('User not found');
      return fn(user);
    });
  }

  async withOrderLock<T>(orderId: string, fn: (order: P2POrder) => Promise<T>): Promise<T> {
    return this.withLocks([`order:${orderId}`], async () => {
      const order = await this.getOrder(orderId);
      if (!order) throw new Error('Order not found');
      return fn(order);
    });
  }

  // ---------- IDs ----------

  newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  async nextOrderId(): Promise<string> {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const c = this.client();
    for (let i = 0; i < 8; i++) {
      const rand = String(Math.floor(100000 + Math.random() * 900000));
      const candidate = `${date}${rand}`;
      const exists = await c.p2POrder.findUnique({ where: { id: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    return `${date}${Date.now().toString().slice(-6)}`;
  }

  // ---------- Audit Logging ----------

  async logAudit(params: {
    actorId?: string;
    actorRole?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    ip?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.client().auditLog.create({
        data: {
          actorId: params.actorId || null,
          actorRole: params.actorRole || null,
          action: params.action,
          targetType: params.targetType || null,
          targetId: params.targetId || null,
          ip: params.ip || null,
          details: (params.details as Prisma.InputJsonValue) || undefined,
        },
      });
    } catch (err) {
      console.warn('Audit log write skipped:', err instanceof Error ? err.message : err);
    }
  }

  // ---------- Users ----------

  async getUser(id: string): Promise<User | undefined> {
    await this.ensureBootstrapped();
    const row = await this.client().user.findUnique({ where: { id } });
    if (!row) return undefined;

    if (!row.depositAddresses) {
      const generated = generateUserDepositAddresses(row.id);
      if (generated) {
        await this.client().user.update({
          where: { id: row.id },
          data: { depositAddresses: generated as unknown as Prisma.InputJsonValue },
        });
        row.depositAddresses = generated as unknown as Prisma.JsonValue;
      }
    }
    return mapUser(row);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    await this.ensureBootstrapped();
    const row = await this.client().user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    return row ? mapUser(row) : undefined;
  }

  async getAllUsers(): Promise<User[]> {
    await this.ensureBootstrapped();
    const rows = await this.client().user.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(mapUser);
  }

  async getSuperadminUser(): Promise<User | undefined> {
    await this.ensureBootstrapped();
    const row = await this.client().user.findFirst({ where: { role: 'SUPERADMIN' } });
    return row ? mapUser(row) : undefined;
  }

  async getUserByTelegram(chatIdOrUsername: string): Promise<User | undefined> {
    await this.ensureBootstrapped();
    const clean = chatIdOrUsername.trim().replace(/^@/, '');
    const row = await this.client().user.findFirst({
      where: {
        OR: [
          { telegramChatId: clean },
          { telegramHandle: { equals: `@${clean}`, mode: 'insensitive' } },
          { telegramLinkCode: { equals: clean, mode: 'insensitive' } },
        ],
      },
    });
    return row ? mapUser(row) : undefined;
  }

  async linkTelegramAccount(
    codeOrUserId: string,
    chatId: string,
    username?: string
  ): Promise<User | undefined> {
    await this.ensureBootstrapped();
    const cleanCode = codeOrUserId.trim().replace(/^link_/i, '');
    const cleanUsername = username?.trim().replace(/^@/, '');

    const target = await this.client().user.findFirst({
      where: {
        OR: [
          { id: cleanCode },
          { telegramLinkCode: { equals: cleanCode, mode: 'insensitive' } },
          ...(cleanUsername
            ? [{ telegramHandle: { equals: `@${cleanUsername}`, mode: 'insensitive' as const } }]
            : []),
        ],
      },
    });

    if (!target) return undefined;

    const updated = await this.client().user.update({
      where: { id: target.id },
      data: {
        telegramChatId: String(chatId),
        telegramHandle: cleanUsername ? `@${cleanUsername}` : target.telegramHandle,
        telegramNotifications: true,
      },
    });

    return mapUser(updated);
  }

  async createUser(params: {
    id?: string;
    email: string;
    name: string;
    nickname?: string;
    role?: User['role'];
    kycStatus?: User['kycStatus'];
    authProvider?: string;
    emailVerified?: boolean;
    telegramHandle?: string;
    telegramChatId?: string;
  }): Promise<User> {
    await this.ensureBootstrapped();
    const id = params.id || this.newId('usr');
    const cleanEmail = params.email.trim().toLowerCase();
    const linkCode = `FETAN-${params.name.split(' ')[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'USER'}-${Math.floor(1000 + Math.random() * 9000)}`;
    const depositAddresses = generateUserDepositAddresses(id);

    const row = await this.client().user.create({
      data: {
        id,
        email: cleanEmail,
        name: params.name.trim(),
        nickname: (params.nickname || params.name).trim(),
        role: params.role || 'USER',
        kycStatus: params.kycStatus || 'UNVERIFIED',
        merchantStatus: params.role === 'MERCHANT' || params.role === 'SUPERADMIN' ? 'APPROVED' : 'NONE',
        authProvider: params.authProvider || 'email',
        emailVerified: params.emailVerified ?? true,
        telegramHandle: params.telegramHandle || null,
        telegramChatId: params.telegramChatId || null,
        telegramLinkCode: linkCode,
        telegramNotifications: true,
        depositAddresses: (depositAddresses as unknown as Prisma.InputJsonValue) || undefined,
        lastLoginAt: new Date(),
      },
    });
    return mapUser(row);
  }

  async saveUser(user: User): Promise<User> {
    return this.updateUser(user.id, user);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const data: Prisma.UserUpdateInput = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.nickname !== undefined) data.nickname = updates.nickname;
    if (updates.phone !== undefined) data.phone = updates.phone || null;
    if (updates.telegramHandle !== undefined) data.telegramHandle = updates.telegramHandle || null;
    if (updates.telegramChatId !== undefined) data.telegramChatId = updates.telegramChatId || null;
    if (updates.telegramNotifications !== undefined)
      data.telegramNotifications = updates.telegramNotifications;
    if (updates.telegramLinkCode !== undefined) data.telegramLinkCode = updates.telegramLinkCode || null;
    if (updates.role !== undefined) data.role = updates.role;
    if (updates.kycStatus !== undefined) data.kycStatus = updates.kycStatus;
    if (updates.kycDocType !== undefined) data.kycDocType = updates.kycDocType || null;
    if (updates.kycDocNumber !== undefined) data.kycDocNumber = updates.kycDocNumber || null;
    if (updates.kycSubmittedAt !== undefined)
      data.kycSubmittedAt = updates.kycSubmittedAt ? new Date(updates.kycSubmittedAt) : null;
    if (updates.merchantStatus !== undefined) data.merchantStatus = updates.merchantStatus;
    if (updates.usdtBalance !== undefined) data.usdtBalance = updates.usdtBalance;
    if (updates.usdtLocked !== undefined) data.usdtLocked = updates.usdtLocked;
    if (updates.paymentDetails !== undefined)
      data.paymentDetails = updates.paymentDetails as unknown as Prisma.InputJsonValue;
    if (updates.depositAddresses !== undefined)
      data.depositAddresses = updates.depositAddresses as unknown as Prisma.InputJsonValue;
    if (updates.completedTrades !== undefined) data.completedTrades = updates.completedTrades;
    if (updates.completionRate !== undefined) data.completionRate = updates.completionRate;
    if (updates.avgReleaseTimeMins !== undefined) data.avgReleaseTimeMins = updates.avgReleaseTimeMins;
    if (updates.rating !== undefined) data.rating = updates.rating;
    if (updates.positiveFeedback !== undefined) data.positiveFeedback = updates.positiveFeedback;
    if (updates.negativeFeedback !== undefined) data.negativeFeedback = updates.negativeFeedback;

    const row = await this.client().user.update({ where: { id }, data });
    return mapUser(row);
  }

  async createOrGetTelegramUser(params: {
    tgId: string;
    username?: string;
    name: string;
    email?: string;
  }): Promise<User> {
    await this.ensureBootstrapped();
    const superTg = (process.env.ADMIN_TELEGRAM_USERNAME || '').replace(/^@/, '').toLowerCase();
    const cleanUser = (params.username || '').replace(/^@/, '').toLowerCase();

    if (superTg && cleanUser === superTg) {
      const superUser = await this.getSuperadminUser();
      if (superUser) {
        return this.updateUser(superUser.id, {
          telegramChatId: String(params.tgId),
          telegramHandle: `@${cleanUser}`,
        });
      }
    }

    const existing =
      (await this.getUserByTelegram(String(params.tgId))) ||
      (cleanUser ? await this.getUserByTelegram(cleanUser) : undefined);

    if (existing) {
      return this.updateUser(existing.id, {
        telegramChatId: String(params.tgId),
        telegramHandle: cleanUser ? `@${cleanUser}` : existing.telegramHandle,
      });
    }

    return this.createUser({
      id: `usr-tg-${params.tgId}`,
      email: params.email || `${cleanUser || params.tgId}@telegram.fetan.et`,
      name: params.name || cleanUser || `Trader ${params.tgId}`,
      nickname: cleanUser || params.name,
      telegramHandle: cleanUser ? `@${cleanUser}` : undefined,
      telegramChatId: String(params.tgId),
      authProvider: 'telegram',
      emailVerified: false,
      role: 'USER',
      kycStatus: 'UNVERIFIED',
    });
  }

  // ---------- Offers ----------

  async getOffers(
    type?: 'SELL' | 'BUY',
    paymentMethod?: PaymentMethod,
    includeInactive = false,
    merchantId?: string
  ): Promise<P2POffer[]> {
    await this.ensureBootstrapped();
    const where: Prisma.P2POfferWhereInput = {};
    if (!includeInactive) where.isActive = true;
    if (type) where.offerType = type;
    if (paymentMethod) where.paymentMethods = { has: paymentMethod };
    if (merchantId) where.merchantId = merchantId;

    const rows = await this.client().p2POffer.findMany({
      where,
      orderBy: [{ pricePerUsdtEtb: type === 'BUY' ? 'desc' : 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(mapOffer);
  }

  async getOffer(id: string): Promise<P2POffer | undefined> {
    const row = await this.client().p2POffer.findUnique({ where: { id } });
    return row ? mapOffer(row) : undefined;
  }

  async createOffer(offer: P2POffer): Promise<P2POffer> {
    const row = await this.client().p2POffer.create({
      data: {
        id: offer.id,
        merchantId: offer.merchantId,
        merchantName: offer.merchantName,
        completedTrades: offer.completedTrades,
        completionRate: offer.completionRate,
        merchantRating: offer.merchantRating ?? 5.0,
        avgReleaseTimeMins: offer.avgReleaseTimeMins ?? 2,
        offerType: offer.offerType,
        pricePerUsdtEtb: offer.pricePerUsdtEtb,
        minLimitEtb: offer.minLimitEtb,
        maxLimitEtb: offer.maxLimitEtb,
        totalAvailable: offer.totalAvailable,
        paymentMethods: offer.paymentMethods,
        terms: offer.terms || null,
        isActive: offer.isActive,
        isOnline: offer.isOnline ?? true,
        isVerifiedMerchant: offer.isVerifiedMerchant ?? true,
      },
    });
    return mapOffer(row);
  }

  async updateOffer(id: string, updates: Partial<P2POffer>): Promise<P2POffer> {
    const data: Prisma.P2POfferUpdateInput = {};
    if (updates.isActive !== undefined) data.isActive = updates.isActive;
    if (updates.pricePerUsdtEtb !== undefined) data.pricePerUsdtEtb = updates.pricePerUsdtEtb;
    if (updates.minLimitEtb !== undefined) data.minLimitEtb = updates.minLimitEtb;
    if (updates.maxLimitEtb !== undefined) data.maxLimitEtb = updates.maxLimitEtb;
    if (updates.totalAvailable !== undefined) data.totalAvailable = updates.totalAvailable;
    if (updates.paymentMethods !== undefined) data.paymentMethods = updates.paymentMethods;
    if (updates.terms !== undefined) data.terms = updates.terms;

    const row = await this.client().p2POffer.update({ where: { id }, data });
    return mapOffer(row);
  }

  async deleteOffer(id: string): Promise<boolean> {
    const existing = await this.client().p2POffer.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return false;
    await this.client().p2POffer.delete({ where: { id } });
    return true;
  }

  // ---------- Orders ----------

  async getOrder(id: string): Promise<P2POrder | undefined> {
    const row = await this.client().p2POrder.findUnique({ where: { id } });
    return row ? mapOrder(row) : undefined;
  }

  async getAllOrders(): Promise<P2POrder[]> {
    const rows = await this.client().p2POrder.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(mapOrder);
  }

  async getOrdersForUser(userId: string): Promise<P2POrder[]> {
    const rows = await this.client().p2POrder.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapOrder);
  }

  async getOpenOrdersForOffer(offerId: string): Promise<P2POrder[]> {
    const rows = await this.client().p2POrder.findMany({
      where: { offerId, status: { in: OPEN_ORDER_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapOrder);
  }

  async saveOrder(order: P2POrder): Promise<P2POrder> {
    const payload = {
      offerId: order.offerId,
      offerType: order.offerType,
      buyerId: order.buyerId,
      buyerName: order.buyerName,
      sellerId: order.sellerId,
      sellerName: order.sellerName,
      usdtAmount: order.usdtAmount,
      etbAmount: order.etbAmount,
      unitPriceEtb: order.unitPriceEtb,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentDetails: order.paymentDetails as unknown as Prisma.InputJsonValue,
      proofReceiptUrl: order.proofReceiptUrl || null,
      expiresAt: new Date(order.expiresAt),
      paidAt: order.paidAt ? new Date(order.paidAt) : null,
      autoReleaseAt: order.autoReleaseAt ? new Date(order.autoReleaseAt) : null,
      isAutoRelease: Boolean(order.isAutoRelease),
      completedAt: order.completedAt ? new Date(order.completedAt) : null,
      cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
      cancelledBy: order.cancelledBy || null,
      cancelReason: order.cancelReason || null,
      disputeReason: order.disputeReason || null,
      appealedBy: order.appealedBy || null,
      appealedAt: order.appealedAt ? new Date(order.appealedAt) : null,
      resolvedBy: order.resolvedBy || null,
      resolutionNote: order.resolutionNote || null,
      buyerFeedback: (order.buyerFeedback as unknown as Prisma.InputJsonValue) || Prisma.JsonNull,
      sellerFeedback: (order.sellerFeedback as unknown as Prisma.InputJsonValue) || Prisma.JsonNull,
      auditLogs: order.auditLogs as unknown as Prisma.InputJsonValue,
    };

    const row = await this.client().p2POrder.upsert({
      where: { id: order.id },
      create: { id: order.id, ...payload },
      update: payload,
    });
    return mapOrder(row);
  }

  // ---------- Chat ----------

  async getChatMessages(orderId: string): Promise<ChatMessage[]> {
    const rows = await this.client().chatMessage.findMany({
      where: { orderId },
      orderBy: { timestamp: 'asc' },
    });
    return rows.map(mapChat);
  }

  async addChatMessage(message: ChatMessage): Promise<ChatMessage> {
    const row = await this.client().chatMessage.create({
      data: {
        id: message.id,
        orderId: message.orderId,
        senderId: message.senderId,
        senderName: message.senderName,
        senderRole: message.senderRole,
        text: message.text,
        imageUrl: message.imageUrl || null,
        type: message.type || 'TEXT',
        isSystem: Boolean(message.isSystem),
        timestamp: new Date(message.timestamp),
      },
    });
    return mapChat(row);
  }

  // ---------- Merchant applications ----------

  async getMerchantApplications(): Promise<MerchantApplication[]> {
    const rows = await this.client().merchantApplication.findMany({
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(mapMerchantApp);
  }

  async getMerchantApplication(id: string): Promise<MerchantApplication | undefined> {
    const row = await this.client().merchantApplication.findUnique({ where: { id } });
    return row ? mapMerchantApp(row) : undefined;
  }

  async saveMerchantApplication(app: MerchantApplication): Promise<MerchantApplication> {
    const payload = {
      userId: app.userId,
      userEmail: app.userEmail,
      userName: app.userName,
      businessName: app.businessName || null,
      telegramHandle: app.telegramHandle,
      kycDocType: app.kycDocType,
      kycDocNumber: app.kycDocNumber,
      proofDocumentUrl: app.proofDocumentUrl || null,
      usdtBalance: app.usdtBalance,
      tradeExperience: app.tradeExperience || null,
      terms: app.terms || null,
      status: app.status,
      submittedAt: new Date(app.submittedAt),
      reviewedBy: app.reviewedBy || null,
      reviewedAt: app.status !== 'PENDING' ? new Date() : null,
    };

    const row = await this.client().merchantApplication.upsert({
      where: { id: app.id },
      create: { id: app.id, ...payload },
      update: payload,
    });
    return mapMerchantApp(row);
  }

  // ---------- KYC ----------

  async getKycSubmissions(): Promise<KycSubmission[]> {
    const rows = await this.client().kycSubmission.findMany({
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(mapKyc);
  }

  async getKycSubmission(id: string): Promise<KycSubmission | undefined> {
    const row = await this.client().kycSubmission.findUnique({ where: { id } });
    return row ? mapKyc(row) : undefined;
  }

  async saveKycSubmission(sub: KycSubmission): Promise<KycSubmission> {
    const payload = {
      userId: sub.userId,
      userEmail: sub.userEmail,
      userName: sub.userName,
      telegramHandle: sub.telegramHandle || null,
      source: sub.source || 'WEB',
      kycDocType: sub.kycDocType,
      kycDocNumber: sub.kycDocNumber,
      docPhotoUrl: sub.docPhotoUrl || null,
      status: sub.status,
      submittedAt: new Date(sub.submittedAt),
      reviewedBy: sub.reviewedBy || null,
      reviewedAt: sub.status !== 'PENDING' ? new Date() : null,
    };

    const row = await this.client().kycSubmission.upsert({
      where: { id: sub.id },
      create: { id: sub.id, ...payload },
      update: payload,
    });
    return mapKyc(row);
  }

  // ---------- Support & Order Complaints ----------

  async getSupportTickets(): Promise<SupportTicket[]> {
    const rows = await this.client().supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapTicket);
  }

  async getSupportTicket(id: string): Promise<SupportTicket | undefined> {
    const row = await this.client().supportTicket.findUnique({ where: { id } });
    return row ? mapTicket(row) : undefined;
  }

  async saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket> {
    const payload = {
      userId: ticket.userId,
      userName: ticket.userName,
      userEmail: ticket.userEmail,
      telegramHandle: ticket.telegramHandle || null,
      orderId: ticket.orderId || null,
      category: ticket.category,
      subject: ticket.subject,
      message: ticket.message,
      status: ticket.status,
      adminReply: ticket.adminReply || null,
      resolvedBy: ticket.resolvedBy || null,
      source: ticket.source,
    };

    const row = await this.client().supportTicket.upsert({
      where: { id: ticket.id },
      create: { id: ticket.id, ...payload },
      update: payload,
    });
    return mapTicket(row);
  }

  // ---------- Wallet Transactions ----------

  async getWalletTransactions(userId?: string): Promise<WalletTransaction[]> {
    const rows = await this.client().walletTransaction.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapWalletTx);
  }

  async getWalletTransaction(id: string): Promise<WalletTransaction | undefined> {
    const row = await this.client().walletTransaction.findUnique({ where: { id } });
    return row ? mapWalletTx(row) : undefined;
  }

  async saveWalletTransaction(tx: WalletTransaction & { reviewedBy?: string }): Promise<WalletTransaction> {
    const payload = {
      userId: tx.userId,
      type: tx.type,
      amount: tx.amount,
      network: tx.network,
      txHash: tx.txHash || null,
      address: tx.address || null,
      status: tx.status,
      note: tx.note || null,
      reviewedBy: tx.reviewedBy || null,
    };

    const row = await this.client().walletTransaction.upsert({
      where: { id: tx.id },
      create: { id: tx.id, ...payload },
      update: payload,
    });
    return mapWalletTx(row);
  }

  async findWalletTransactionByTxHash(txHash: string): Promise<WalletTransaction | undefined> {
    const clean = txHash.trim();
    const row = await this.client().walletTransaction.findFirst({
      where: { txHash: { equals: clean, mode: 'insensitive' } },
    });
    return row ? mapWalletTx(row) : undefined;
  }
}

const globalForDb = global as unknown as { dbStore?: DatabaseStore };
export const db = globalForDb.dbStore || new DatabaseStore();
if (process.env.NODE_ENV !== 'production') globalForDb.dbStore = db;
