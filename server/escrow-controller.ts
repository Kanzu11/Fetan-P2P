import { db } from './database/store';
import {
  P2POrder,
  PaymentMethod,
  PAYMENT_METHODS_META,
  User,
  displayName,
  isAdminRole,
} from '../client/types';
import { wsGateway } from './websocket-gateway';
import { telegramBot } from './telegram-bot';
import { emailService } from './email-service';
import { prisma } from './database/prisma';

function resolveSellerPaymentDetails(
  seller: User,
  method: PaymentMethod,
  customAccountNumber?: string,
  customAccountName?: string
) {
  const pd = seller.paymentDetails || {};
  const meta = PAYMENT_METHODS_META[method] || PAYMENT_METHODS_META.TELEBIRR;
  const holderName = customAccountName?.trim() || displayName(seller.name);

  switch (method) {
    case 'TELEBIRR': {
      const accountNumber = customAccountNumber?.trim() || pd.telebirr || seller.phone;
      if (!accountNumber) {
        throw new Error(
          `Seller has not configured a Telebirr number yet. Configure Bank & Telebirr details first.`
        );
      }
      return {
        method,
        accountNumber,
        accountName: holderName,
        phone: accountNumber,
        bankName: 'Telebirr',
      };
    }
    case 'CBE': {
      const accountNumber = customAccountNumber?.trim() || pd.cbeAccount;
      if (!accountNumber) {
        throw new Error(`Seller has not configured a CBE account number yet.`);
      }
      return {
        method,
        accountNumber,
        accountName: customAccountName?.trim() || pd.cbeHolder || holderName,
        bankName: 'Commercial Bank of Ethiopia (CBE)',
      };
    }
    case 'ABYSSINIA': {
      const accountNumber = customAccountNumber?.trim() || pd.abyssiniaAccount;
      if (!accountNumber) {
        throw new Error(`Seller has not configured a Bank of Abyssinia account number yet.`);
      }
      return {
        method,
        accountNumber,
        accountName: customAccountName?.trim() || pd.abyssiniaHolder || holderName,
        bankName: 'Bank of Abyssinia',
      };
    }
    case 'AWASH': {
      const accountNumber = customAccountNumber?.trim() || pd.awashAccount;
      if (!accountNumber) {
        throw new Error(`Seller has not configured an Awash Bank account number yet.`);
      }
      return {
        method,
        accountNumber,
        accountName: customAccountName?.trim() || pd.awashHolder || holderName,
        bankName: 'Awash Bank',
      };
    }
    case 'CBE_BIRR': {
      const accountNumber = customAccountNumber?.trim() || pd.cbeBirr || pd.telebirr;
      if (!accountNumber) {
        throw new Error(`Seller has not configured a CBE Birr phone number yet.`);
      }
      return {
        method,
        accountNumber,
        accountName: holderName,
        bankName: 'CBE Birr',
      };
    }
    case 'DASHEN': {
      const accountNumber = customAccountNumber?.trim() || pd.dashenAccount;
      if (!accountNumber) {
        throw new Error(`Seller has not configured a Dashen Bank account number yet.`);
      }
      return {
        method,
        accountNumber,
        accountName: holderName,
        bankName: meta.name,
      };
    }
  }
}

export class EscrowController {
  /**
   * 1. CREATE ORDER & LOCK SELLER USDT IN ESCROW
   */
  async lockEscrow(params: {
    offerId: string;
    buyerId: string; // Initiator user ID
    usdtAmount: number;
    paymentMethod: PaymentMethod;
    sellerAccountNumber?: string;
    sellerAccountName?: string;
  }): Promise<P2POrder> {
    const {
      offerId,
      buyerId: initiatorId,
      usdtAmount,
      paymentMethod,
      sellerAccountNumber,
      sellerAccountName,
    } = params;

    if (!Number.isFinite(usdtAmount) || usdtAmount <= 0) {
      throw new Error('Please enter a valid USDT amount.');
    }

    const offerInitial = await db.getOffer(offerId);
    if (!offerInitial) throw new Error('This offer is no longer available.');
    if (offerInitial.isActive === false) {
      throw new Error('This ad is currently paused by the merchant.');
    }

    const actualSellerId = offerInitial.offerType === 'SELL' ? offerInitial.merchantId : initiatorId;
    const actualBuyerId = offerInitial.offerType === 'SELL' ? initiatorId : offerInitial.merchantId;

    if (actualSellerId === actualBuyerId) {
      throw new Error('You cannot trade on your own ad.');
    }

    const result = await db.withLocks(
      [`offer:${offerId}`, `user:${actualSellerId}`, `user:${actualBuyerId}`],
      async () => {
        const offer = await db.getOffer(offerId);
        if (!offer) throw new Error('Offer not found.');
        if (!offer.isActive) throw new Error('This ad is currently paused.');

        const seller = await db.getUser(actualSellerId);
        const buyer = await db.getUser(actualBuyerId);
        if (!seller || !buyer) {
          throw new Error('User account not found.');
        }

        const initiator = await db.getUser(initiatorId);
        if (!initiator || (initiator.kycStatus !== 'VERIFIED' && !isAdminRole(initiator.role))) {
          throw new Error(
            'Identity verification (KYC) is required before trading. Please complete KYC first.'
          );
        }
        if (initiator.isSuspended) {
          throw new Error(
            initiator.suspendReason
              ? `Account suspended: ${initiator.suspendReason}`
              : 'Your account is suspended and cannot open new P2P orders.'
          );
        }
        if (buyer.isSuspended || seller.isSuspended) {
          throw new Error('This counterparty account is currently suspended.');
        }
        if (
          (buyer.kycStatus !== 'VERIFIED' && !isAdminRole(buyer.role)) ||
          (seller.kycStatus !== 'VERIFIED' && !isAdminRole(seller.role))
        ) {
          throw new Error('Both buyer and seller must have verified KYC before starting an order.');
        }

        const etbAmount = Number((usdtAmount * offer.pricePerUsdtEtb).toFixed(2));

        if (etbAmount < offer.minLimitEtb - 0.01 || etbAmount > offer.maxLimitEtb + 0.01) {
          throw new Error(
            `Order total (${etbAmount.toLocaleString()} ETB) must be between ${offer.minLimitEtb.toLocaleString()} and ${offer.maxLimitEtb.toLocaleString()} ETB.`
          );
        }

        if (usdtAmount > offer.totalAvailable + 0.0001) {
          throw new Error(`Only ${offer.totalAvailable.toFixed(2)} USDT is left on this ad.`);
        }

        if (seller.usdtBalance < usdtAmount) {
          throw new Error(
            `Not enough available USDT to lock in escrow (Available: ${seller.usdtBalance.toFixed(2)} USDT, Needed: ${usdtAmount.toFixed(2)} USDT).`
          );
        }

        let updatedSeller = seller;
        if (sellerAccountNumber && sellerAccountNumber.trim()) {
          const meta = PAYMENT_METHODS_META[paymentMethod];
          const updatedDetails = { ...(seller.paymentDetails || {}) };
          if (meta) {
            updatedDetails[meta.accountField] = sellerAccountNumber.trim();
          }
          updatedSeller = await db.updateUser(seller.id, { paymentDetails: updatedDetails });
        }

        const paymentDetails = resolveSellerPaymentDetails(
          updatedSeller,
          paymentMethod,
          sellerAccountNumber,
          sellerAccountName
        );

        const newSellerBalance = Number((seller.usdtBalance - usdtAmount).toFixed(6));
        const newSellerLocked = Number((seller.usdtLocked + usdtAmount).toFixed(6));

        await db.updateUser(seller.id, {
          usdtBalance: newSellerBalance,
          usdtLocked: newSellerLocked,
        });

        await db.updateOffer(offer.id, {
          totalAvailable: Number(Math.max(0, offer.totalAvailable - usdtAmount).toFixed(4)),
        });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
        const orderId = await db.nextOrderId();
        const methodShortName = PAYMENT_METHODS_META[paymentMethod]?.shortName || paymentMethod;

        const order: P2POrder = {
          id: orderId,
          offerId,
          offerType: offer.offerType,
          buyerId: actualBuyerId,
          buyerName: buyer.name,
          sellerId: actualSellerId,
          sellerName: seller.name,
          usdtAmount,
          etbAmount,
          unitPriceEtb: offer.pricePerUsdtEtb,
          status: 'PENDING_PAYMENT',
          paymentMethod,
          paymentDetails,
          expiresAt: expiresAt.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          auditLogs: [
            {
              id: `log-${Date.now()}-1`,
              timestamp: now.toISOString(),
              message: `Order created. ${usdtAmount.toFixed(2)} USDT locked in escrow from ${displayName(seller.name)}.`,
              actor: 'SYSTEM',
            },
            {
              id: `log-${Date.now()}-2`,
              timestamp: now.toISOString(),
              message: `Waiting for ${displayName(buyer.name)} to send ${etbAmount.toLocaleString()} ETB via ${methodShortName} within 15 minutes.`,
              actor: 'SYSTEM',
            },
          ],
        };

        const savedOrder = await db.saveOrder(order);

        await db.addChatMessage({
          id: `msg-${Date.now()}-sys`,
          orderId,
          senderId: 'SYSTEM',
          senderName: 'Fetan Escrow',
          senderRole: 'ADMIN',
          text: `${usdtAmount.toFixed(2)} USDT is locked in escrow. ${displayName(buyer.name)}, please send ${etbAmount.toLocaleString()} ETB to ${paymentDetails.accountName} (${paymentDetails.accountNumber}) via ${paymentDetails.bankName}, then click "I Have Paid".`,
          timestamp: now.toISOString(),
          isSystem: true,
        });

        if (offer.terms) {
          await db.addChatMessage({
            id: `msg-${Date.now()}-terms`,
            orderId,
            senderId: offer.merchantId,
            senderName: displayName(offer.merchantName),
            senderRole: 'MERCHANT',
            text: `Merchant terms: ${offer.terms}`,
            timestamp: new Date(now.getTime() + 400).toISOString(),
          });
        }

        return { savedOrder, newSellerBalance, newSellerLocked, buyer, seller: updatedSeller };
      }
    );

    wsGateway.emitToUser(actualSellerId, 'balance_updated', {
      usdtBalance: result.newSellerBalance,
      usdtLocked: result.newSellerLocked,
    });
    wsGateway.emitToRoom(`trade:${result.savedOrder.id}`, 'escrow_locked', result.savedOrder);
    void telegramBot.sendOrderNotification(result.savedOrder, 'CREATED');
    void emailService
      .notifyOrderCreated(result.savedOrder, result.buyer, result.seller)
      .catch(() => {});

    return result.savedOrder;
  }

  /**
   * 2. BUYER MARKS ORDER AS PAID (PENDING_PAYMENT -> PAYMENT_SENT)
   */
  async confirmPayment(
    orderId: string,
    actorId: string,
    proofReceiptUrl?: string
  ): Promise<P2POrder> {
    const allowDemoAutoRelease = process.env.ENABLE_DEMO_AUTORELEASE === 'true';

    const updatedOrder = await db.withOrderLock(orderId, async (order) => {
      const actor = await db.getUser(actorId);
      const isAdmin = isAdminRole(actor?.role);

      if (order.buyerId !== actorId && !isAdmin) {
        throw new Error('Only the buyer can mark this order as paid.');
      }
      if (order.status !== 'PENDING_PAYMENT') {
        throw new Error(`This order cannot be marked paid because its status is ${order.status}.`);
      }

      const now = new Date();
      const methodShortName =
        PAYMENT_METHODS_META[order.paymentMethod]?.shortName || order.paymentMethod;
      const cleanRef = proofReceiptUrl?.trim();
      const autoReleaseDelaySeconds = 15;
      const autoReleaseDate = allowDemoAutoRelease
        ? new Date(now.getTime() + autoReleaseDelaySeconds * 1000).toISOString()
        : undefined;

      const updatedLogs = [
        ...order.auditLogs,
        {
          id: `log-${Date.now()}`,
          timestamp: now.toISOString(),
          message: `Buyer marked ${order.etbAmount.toLocaleString()} ETB as paid via ${methodShortName}.${cleanRef ? ` Reference: ${cleanRef}` : ''}`,
          actor: 'BUYER' as const,
        },
      ];

      const nextOrder: P2POrder = {
        ...order,
        status: 'PAYMENT_SENT',
        paidAt: now.toISOString(),
        autoReleaseAt: autoReleaseDate,
        proofReceiptUrl: cleanRef || order.proofReceiptUrl,
        auditLogs: updatedLogs,
        updatedAt: now.toISOString(),
      };

      await db.saveOrder(nextOrder);

      await db.addChatMessage({
        id: `msg-${Date.now()}`,
        orderId,
        senderId: 'SYSTEM',
        senderName: 'Fetan Escrow',
        senderRole: 'ADMIN',
        text: allowDemoAutoRelease
          ? `Buyer marked ${order.etbAmount.toLocaleString()} ETB as paid.${cleanRef ? ` Ref: ${cleanRef}.` : ''} Auto-release enabled in ${autoReleaseDelaySeconds}s.`
          : `Buyer marked ${order.etbAmount.toLocaleString()} ETB as paid.${cleanRef ? ` Ref: ${cleanRef}.` : ''} Waiting for seller (${displayName(order.sellerName)}) to verify receipt in their bank/Telebirr account and click "Confirm & Release USDT".`,
        timestamp: now.toISOString(),
        isSystem: true,
      });

      return nextOrder;
    });

    wsGateway.emitToRoom(`trade:${orderId}`, 'payment_confirmed', updatedOrder);
    wsGateway.emitToUser(updatedOrder.sellerId, 'payment_alert', {
      orderId,
      etbAmount: updatedOrder.etbAmount,
    });
    void telegramBot.sendOrderNotification(updatedOrder, 'PAID');
    void db
      .getUser(updatedOrder.sellerId)
      .then((seller) => emailService.notifyOrderPaid(updatedOrder, seller || undefined))
      .catch(() => {});

    if (allowDemoAutoRelease) {
      this.scheduleAutoRelease(orderId, 15);
    }

    return updatedOrder;
  }

  /**
   * Optional Auto-Release Scheduler (strictly opt-in via ENABLE_DEMO_AUTORELEASE=true).
   */
  scheduleAutoRelease(orderId: string, delaySeconds: number = 15): void {
    setTimeout(async () => {
      try {
        const order = await db.getOrder(orderId);
        if (order && order.status === 'PAYMENT_SENT') {
          await this.releaseEscrow(
            orderId,
            'AUTO_RELEASE',
            'Automated escrow release upon order payment completion'
          );
        }
      } catch (err: unknown) {
        console.warn(`[Auto-Release] Notice for Order #${orderId}:`, err instanceof Error ? err.message : err);
      }
    }, delaySeconds * 1000);
  }

  /**
   * 3. COMPLETE ORDER & RELEASE ESCROW TO BUYER (Seller or Admin)
   */
  async releaseEscrow(orderId: string, actorId: string, note?: string): Promise<P2POrder> {
    const existingOrder = await db.getOrder(orderId);
    if (!existingOrder) throw new Error('Order not found.');

    const result = await db.withLocks(
      [`order:${orderId}`, `user:${existingOrder.sellerId}`, `user:${existingOrder.buyerId}`],
      async () => {
        const order = await db.getOrder(orderId);
        if (!order) throw new Error('Order not found.');

        const isSystemAutoRelease =
          (actorId === 'AUTO_RELEASE' || actorId === 'SYSTEM') &&
          process.env.ENABLE_DEMO_AUTORELEASE === 'true';

        const actor = isSystemAutoRelease ? undefined : await db.getUser(actorId);
        const isAdmin = isAdminRole(actor?.role);

        if (order.sellerId !== actorId && !isAdmin && !isSystemAutoRelease) {
          throw new Error(
            'Only the seller or an administrator can release USDT and complete this order.'
          );
        }
        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
          throw new Error(`This order is already ${order.status.toLowerCase()}.`);
        }

        if (!isAdmin && !isSystemAutoRelease && order.status === 'PENDING_PAYMENT') {
          throw new Error('Wait for the buyer to mark the order as paid before releasing USDT.');
        }

        const seller = await db.getUser(order.sellerId);
        const buyer = await db.getUser(order.buyerId);
        if (!seller || !buyer) {
          throw new Error('Order participant account not found.');
        }

        const deductLocked = Math.min(seller.usdtLocked, order.usdtAmount);
        const newSellerLocked = Number(Math.max(0, seller.usdtLocked - deductLocked).toFixed(6));
        const newBuyerBalance = Number((buyer.usdtBalance + order.usdtAmount).toFixed(6));

        const elapsedMins = Math.min(
          120,
          Math.max(
            1,
            Math.round(
              (Date.now() - new Date(order.paidAt || order.createdAt).getTime()) / 60000
            )
          )
        );
        const prevSellerTrades = seller.completedTrades || 0;
        const prevAvgRelease = seller.avgReleaseTimeMins || 2;
        const nextAvgRelease = Math.max(
          1,
          Math.round((prevAvgRelease * prevSellerTrades + elapsedMins) / (prevSellerTrades + 1))
        );
        const nextSellerCompletedTrades = prevSellerTrades + 1;

        await db.updateUser(seller.id, {
          usdtLocked: newSellerLocked,
          completedTrades: nextSellerCompletedTrades,
          avgReleaseTimeMins: nextAvgRelease,
        });
        await db.updateUser(buyer.id, {
          usdtBalance: newBuyerBalance,
          completedTrades: (buyer.completedTrades || 0) + 1,
        });

        const now = new Date();
        const isReleasedByAdmin = isAdmin && order.sellerId !== actorId && !isSystemAutoRelease;
        const cleanNote = note?.trim();

        const releasedByMsg = isSystemAutoRelease
          ? `Automatic Escrow Release: Order verified and ${order.usdtAmount.toFixed(2)} USDT released to ${displayName(buyer.name)}.`
          : isReleasedByAdmin
          ? `Admin (${displayName(actor?.name)}) completed the order and released ${order.usdtAmount.toFixed(2)} USDT to ${displayName(buyer.name)}.${cleanNote ? ` Note: ${cleanNote}` : ''}`
          : `Seller confirmed receiving ${order.etbAmount.toLocaleString()} ETB and released ${order.usdtAmount.toFixed(2)} USDT to ${displayName(buyer.name)}.`;

        const updatedLogs = [
          ...order.auditLogs,
          {
            id: `log-${Date.now()}`,
            timestamp: now.toISOString(),
            message: releasedByMsg,
            actor: isSystemAutoRelease
              ? ('SYSTEM' as const)
              : isReleasedByAdmin
              ? ('ADMIN' as const)
              : ('SELLER' as const),
          },
        ];

        const updatedOrder: P2POrder = {
          ...order,
          status: 'COMPLETED',
          completedAt: now.toISOString(),
          isAutoRelease: isSystemAutoRelease,
          resolvedBy: isSystemAutoRelease
            ? 'Fetan Auto-Release Engine'
            : isReleasedByAdmin
            ? displayName(actor?.name)
            : order.resolvedBy,
          resolutionNote: cleanNote || order.resolutionNote,
          auditLogs: updatedLogs,
          updatedAt: now.toISOString(),
        };

        await db.saveOrder(updatedOrder);

        await db.addChatMessage({
          id: `msg-${Date.now()}`,
          orderId,
          senderId: 'SYSTEM',
          senderName: 'Fetan Escrow',
          senderRole: 'ADMIN',
          text: isReleasedByAdmin
            ? `Order completed by Admin. ${order.usdtAmount.toFixed(2)} USDT has been added to ${displayName(buyer.name)}'s wallet.${cleanNote ? ` Note: ${cleanNote}` : ''}`
            : `Order completed! ${order.usdtAmount.toFixed(2)} USDT has been added to ${displayName(buyer.name)}'s wallet with zero fee.`,
          timestamp: now.toISOString(),
          isSystem: true,
        });

        await db.logAudit({
          actorId: isSystemAutoRelease ? 'SYSTEM' : actorId,
          actorRole: isSystemAutoRelease ? 'SYSTEM' : actor?.role,
          action: 'ORDER_ESCROW_RELEASED',
          targetType: 'P2POrder',
          targetId: orderId,
          details: { usdtAmount: order.usdtAmount, buyerId: buyer.id, sellerId: seller.id },
        });

        return {
          updatedOrder,
          seller,
          buyer,
          newSellerLocked,
          newBuyerBalance,
          nextAvgRelease,
          nextSellerCompletedTrades,
        };
      }
    );

    void prisma.p2POffer
      .updateMany({
        where: { merchantId: result.seller.id },
        data: {
          avgReleaseTimeMins: result.nextAvgRelease,
          completedTrades: result.nextSellerCompletedTrades,
        },
      })
      .catch(() => {});

    wsGateway.emitToRoom(`trade:${orderId}`, 'escrow_released', result.updatedOrder);
    wsGateway.emitToUser(result.seller.id, 'balance_updated', {
      usdtBalance: result.seller.usdtBalance,
      usdtLocked: result.newSellerLocked,
    });
    wsGateway.emitToUser(result.buyer.id, 'balance_updated', {
      usdtBalance: result.newBuyerBalance,
      usdtLocked: result.buyer.usdtLocked,
    });
    void telegramBot.sendOrderNotification(result.updatedOrder, 'COMPLETED');
    void emailService
      .notifyOrderCompleted(result.updatedOrder, result.buyer, result.seller)
      .catch(() => {});

    return result.updatedOrder;
  }

  /**
   * 4. CANCEL ORDER & RETURN LOCKED USDT TO SELLER (Buyer or Admin)
   */
  async cancelEscrow(orderId: string, actorId: string, reason?: string): Promise<P2POrder> {
    const existingOrder = await db.getOrder(orderId);
    if (!existingOrder) throw new Error('Order not found.');

    const result = await db.withLocks(
      [`order:${orderId}`, `user:${existingOrder.sellerId}`, `offer:${existingOrder.offerId}`],
      async () => {
        const order = await db.getOrder(orderId);
        if (!order) throw new Error('Order not found.');

        const actor = await db.getUser(actorId);
        const isAdmin = isAdminRole(actor?.role);

        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
          throw new Error(`This order is already ${order.status.toLowerCase()}.`);
        }

        if (!isAdmin) {
          if (order.buyerId !== actorId) {
            throw new Error('Only the buyer or an admin can cancel this order.');
          }
          if (order.status === 'DISPUTED') {
            throw new Error(
              'This order is under support review. Only an admin can resolve or cancel a disputed order.'
            );
          }
        }

        const seller = await db.getUser(order.sellerId);
        if (!seller) throw new Error('Seller account not found.');

        const unlockAmount = Math.min(seller.usdtLocked, order.usdtAmount);
        const newSellerLocked = Number(Math.max(0, seller.usdtLocked - unlockAmount).toFixed(6));
        const newSellerBalance = Number((seller.usdtBalance + unlockAmount).toFixed(6));

        await db.updateUser(seller.id, {
          usdtBalance: newSellerBalance,
          usdtLocked: newSellerLocked,
        });

        const offer = await db.getOffer(order.offerId);
        if (offer) {
          await db.updateOffer(offer.id, {
            totalAvailable: Number((offer.totalAvailable + order.usdtAmount).toFixed(4)),
          });
        }

        const now = new Date();
        const isCancelledByAdmin = isAdmin && order.buyerId !== actorId;
        const cleanReason = reason?.trim();

        const cancelMsg = isCancelledByAdmin
          ? `Order cancelled by Admin (${displayName(actor?.name)}). ${order.usdtAmount.toFixed(2)} USDT was returned to ${displayName(seller.name)}.${cleanReason ? ` Reason: ${cleanReason}` : ''}`
          : `Order cancelled by buyer (${displayName(order.buyerName)}). ${order.usdtAmount.toFixed(2)} USDT was returned to ${displayName(seller.name)}.${cleanReason ? ` Reason: ${cleanReason}` : ''}`;

        const updatedOrder: P2POrder = {
          ...order,
          status: 'CANCELLED',
          cancelledAt: now.toISOString(),
          cancelledBy: isCancelledByAdmin ? 'ADMIN' : 'BUYER',
          cancelReason: cleanReason || (isCancelledByAdmin ? 'Cancelled by Admin' : 'Cancelled by Buyer'),
          resolvedBy: isCancelledByAdmin ? displayName(actor?.name) : order.resolvedBy,
          resolutionNote: isCancelledByAdmin && cleanReason ? cleanReason : order.resolutionNote,
          auditLogs: [
            ...order.auditLogs,
            {
              id: `log-${Date.now()}`,
              timestamp: now.toISOString(),
              message: cancelMsg,
              actor: isCancelledByAdmin ? ('ADMIN' as const) : ('BUYER' as const),
            },
          ],
          updatedAt: now.toISOString(),
        };

        await db.saveOrder(updatedOrder);

        await db.addChatMessage({
          id: `msg-${Date.now()}`,
          orderId,
          senderId: 'SYSTEM',
          senderName: 'Fetan Escrow',
          senderRole: 'ADMIN',
          text: cancelMsg,
          timestamp: now.toISOString(),
          isSystem: true,
        });

        await db.logAudit({
          actorId,
          actorRole: actor?.role,
          action: 'ORDER_ESCROW_CANCELLED',
          targetType: 'P2POrder',
          targetId: orderId,
          details: { reason: cleanReason },
        });

        return { updatedOrder, sellerId: seller.id, newSellerBalance, newSellerLocked };
      }
    );

    wsGateway.emitToRoom(`trade:${orderId}`, 'escrow_released', result.updatedOrder);
    wsGateway.emitToUser(result.sellerId, 'balance_updated', {
      usdtBalance: result.newSellerBalance,
      usdtLocked: result.newSellerLocked,
    });
    void telegramBot.sendOrderNotification(result.updatedOrder, 'CANCELLED');

    return result.updatedOrder;
  }

  /**
   * 5. OPEN APPEAL / DISPUTE (Buyer or Seller asks Admin to step in)
   */
  async disputeTrade(orderId: string, userId: string, reason: string): Promise<P2POrder> {
    const updatedOrder = await db.withOrderLock(orderId, async (order) => {
      const actor = await db.getUser(userId);
      const isAdmin = isAdminRole(actor?.role);

      if (order.buyerId !== userId && order.sellerId !== userId && !isAdmin) {
        throw new Error('Only the buyer, seller, or an admin can open an appeal on this order.');
      }
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        throw new Error(`Cannot open an appeal on a ${order.status.toLowerCase()} order.`);
      }

      const now = new Date();
      const roleLabel =
        userId === order.buyerId ? 'Buyer' : userId === order.sellerId ? 'Seller' : 'Admin';
      const cleanReason = reason.trim();

      const nextOrder: P2POrder = {
        ...order,
        status: 'DISPUTED',
        disputeReason: cleanReason,
        appealedBy: roleLabel,
        appealedAt: now.toISOString(),
        auditLogs: [
          ...order.auditLogs,
          {
            id: `log-${Date.now()}`,
            timestamp: now.toISOString(),
            message: `Appeal opened by ${roleLabel}: "${cleanReason}". USDT stays locked until Admin resolves the order.`,
            actor: userId === order.buyerId ? ('BUYER' as const) : ('SELLER' as const),
          },
        ],
        updatedAt: now.toISOString(),
      };

      await db.saveOrder(nextOrder);

      await db.addChatMessage({
        id: `msg-${Date.now()}`,
        orderId,
        senderId: 'SYSTEM',
        senderName: 'Fetan Support',
        senderRole: 'ADMIN',
        text: `Appeal opened by ${roleLabel}: "${cleanReason}". A Fetan Admin is reviewing this order. Please share payment details or screenshots in the chat.`,
        timestamp: now.toISOString(),
        isSystem: true,
      });

      return nextOrder;
    });

    wsGateway.emitToRoom('admin:dashboard', 'dispute_alert', updatedOrder);
    wsGateway.emitToRoom(`trade:${orderId}`, 'dispute_alert', updatedOrder);
    void telegramBot.sendDisputeAlert(updatedOrder);
    void emailService.notifyOrderDisputed(updatedOrder).catch(() => {});

    return updatedOrder;
  }

  /**
   * 6. LEAVE POST-ORDER FEEDBACK (Buyer or Seller rates completed trade)
   */
  async leaveFeedback(
    orderId: string,
    userId: string,
    rating: 'POSITIVE' | 'NEGATIVE',
    comment?: string
  ): Promise<P2POrder> {
    return db.withOrderLock(orderId, async (order) => {
      if (order.status !== 'COMPLETED') {
        throw new Error('You can only leave a review after the order is completed.');
      }
      const isBuyer = order.buyerId === userId;
      const isSeller = order.sellerId === userId;
      if (!isBuyer && !isSeller) {
        throw new Error('Only the buyer or seller can review this order.');
      }

      const feedback = {
        rating,
        comment: comment?.trim() || (rating === 'POSITIVE' ? 'Fast and smooth trade!' : 'Slow response.'),
        createdAt: new Date().toISOString(),
      };

      const alreadySubmitted = isBuyer ? Boolean(order.buyerFeedback) : Boolean(order.sellerFeedback);

      const updatedOrder: P2POrder = {
        ...order,
        buyerFeedback: isBuyer ? feedback : order.buyerFeedback,
        sellerFeedback: isSeller ? feedback : order.sellerFeedback,
        updatedAt: new Date().toISOString(),
      };

      const saved = await db.saveOrder(updatedOrder);

      if (!alreadySubmitted) {
        const targetUserId = isBuyer ? order.sellerId : order.buyerId;
        const targetUser = await db.getUser(targetUserId);
        if (targetUser) {
          const nextPos = (targetUser.positiveFeedback || 0) + (rating === 'POSITIVE' ? 1 : 0);
          const nextNeg = (targetUser.negativeFeedback || 0) + (rating === 'NEGATIVE' ? 1 : 0);
          const total = nextPos + nextNeg;
          const nextRating =
            total > 0 ? Math.min(5, Math.max(1, Number(((nextPos / total) * 5).toFixed(1)))) : 5;
          await db.updateUser(targetUserId, {
            positiveFeedback: nextPos,
            negativeFeedback: nextNeg,
            rating: nextRating,
          });
          void prisma.p2POffer
            .updateMany({
              where: { merchantId: targetUserId },
              data: { merchantRating: nextRating },
            })
            .catch(() => {});
        }
      }

      return saved;
    });
  }

  /**
   * 7. SWEEP EXPIRED UNPAID ORDERS & REFUND ESCROW TO SELLER
   */
  async sweepExpiredOrders(
    expiredCandidates?: Array<{ id: string; sellerId: string }>
  ): Promise<{ expiredCount: number }> {
    const candidates =
      expiredCandidates ??
      (await prisma.p2POrder.findMany({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lte: new Date() },
        },
        select: { id: true, sellerId: true },
        take: 25,
      }));

    let expiredCount = 0;

    for (const candidate of candidates) {
      try {
        const res = await db.withLocks(
          [`order:${candidate.id}`, `user:${candidate.sellerId}`],
          async () => {
            const order = await db.getOrder(candidate.id);
            if (!order || order.status !== 'PENDING_PAYMENT') {
              return null;
            }
            if (new Date(order.expiresAt).getTime() > Date.now()) {
              return null;
            }

            const seller = await db.getUser(order.sellerId);
            if (!seller) return null;

            const unlockAmount = Math.min(seller.usdtLocked, order.usdtAmount);
            const newSellerLocked = Number(Math.max(0, seller.usdtLocked - unlockAmount).toFixed(6));
            const newSellerBalance = Number((seller.usdtBalance + unlockAmount).toFixed(6));

            await db.updateUser(seller.id, {
              usdtBalance: newSellerBalance,
              usdtLocked: newSellerLocked,
            });

            const offer = await db.getOffer(order.offerId);
            if (offer) {
              await db.updateOffer(offer.id, {
                totalAvailable: Number((offer.totalAvailable + order.usdtAmount).toFixed(4)),
                isActive: true,
              });
            }

            const now = new Date();
            const updatedOrder: P2POrder = {
              ...order,
              status: 'CANCELLED',
              cancelledAt: now.toISOString(),
              cancelledBy: 'SYSTEM',
              cancelReason: 'Payment window expired (15m auto-cancel)',
              auditLogs: [
                ...order.auditLogs,
                {
                  id: `log-${Date.now()}`,
                  timestamp: now.toISOString(),
                  message: `Payment timer expired. ${order.usdtAmount.toFixed(2)} USDT automatically unlocked back to ${displayName(seller.name)}.`,
                  actor: 'SYSTEM',
                },
              ],
              updatedAt: now.toISOString(),
            };

            await db.saveOrder(updatedOrder);
            await db.logAudit({
              actorId: 'SYSTEM',
              actorRole: 'SYSTEM',
              action: 'ORDER_AUTO_EXPIRED',
              targetType: 'P2POrder',
              targetId: order.id,
              details: { unlockedUsdt: unlockAmount, sellerId: seller.id },
            });

            return { updatedOrder, sellerId: seller.id, newSellerBalance, newSellerLocked };
          }
        );

        if (res) {
          expiredCount++;
          wsGateway.emitToRoom(`trade:${res.updatedOrder.id}`, 'escrow_released', res.updatedOrder);
          wsGateway.emitToUser(res.sellerId, 'balance_updated', {
            usdtBalance: res.newSellerBalance,
            usdtLocked: res.newSellerLocked,
          });
          void telegramBot.sendOrderNotification(res.updatedOrder, 'CANCELLED');
        }
      } catch (err) {
        console.warn(`Failed to sweep expired order ${candidate.id}:`, err);
      }
    }

    return { expiredCount };
  }
}

export const escrowController = new EscrowController();
