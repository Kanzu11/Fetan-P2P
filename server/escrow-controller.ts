import { db } from '../lib/db/store';
import {
  P2POrder,
  PaymentMethod,
  PAYMENT_METHODS_META,
  User,
  displayName,
  isAdminRole,
} from '../lib/types';
import { wsGateway } from './websocket-gateway';
import { telegramBot } from './telegram-bot';

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
    case 'TELEBIRR':
      return {
        method,
        accountNumber: customAccountNumber?.trim() || pd.telebirr || seller.phone || '0911234567',
        accountName: holderName,
        phone: customAccountNumber?.trim() || pd.telebirr || seller.phone || '+251 911 234 567',
        bankName: 'Telebirr',
      };
    case 'CBE':
      return {
        method,
        accountNumber: customAccountNumber?.trim() || pd.cbeAccount || '1000123456789',
        accountName: customAccountName?.trim() || pd.cbeHolder || holderName,
        bankName: 'Commercial Bank of Ethiopia (CBE)',
      };
    case 'ABYSSINIA':
      return {
        method,
        accountNumber: customAccountNumber?.trim() || pd.abyssiniaAccount || '88201944',
        accountName: customAccountName?.trim() || pd.abyssiniaHolder || holderName,
        bankName: 'Bank of Abyssinia',
      };
    case 'AWASH':
      return {
        method,
        accountNumber: customAccountNumber?.trim() || pd.awashAccount || '01320987654321',
        accountName: customAccountName?.trim() || pd.awashHolder || holderName,
        bankName: 'Awash Bank',
      };
    case 'CBE_BIRR':
      return {
        method,
        accountNumber: customAccountNumber?.trim() || pd.cbeBirr || pd.telebirr || '0911234567',
        accountName: holderName,
        bankName: 'CBE Birr',
      };
    case 'DASHEN':
      return {
        method,
        accountNumber: customAccountNumber?.trim() || pd.dashenAccount || '5029184720112',
        accountName: holderName,
        bankName: meta.name,
      };
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

    const offerInitial = db.getOffer(offerId);
    if (!offerInitial) throw new Error('This offer is no longer available.');
    if (offerInitial.isActive === false) {
      throw new Error('This ad is currently paused by the merchant.');
    }

    // SELL offer = Merchant sells USDT, Initiator buys USDT
    // BUY offer  = Merchant buys USDT, Initiator sells USDT
    const actualSellerId = offerInitial.offerType === 'SELL' ? offerInitial.merchantId : initiatorId;
    const actualBuyerId = offerInitial.offerType === 'SELL' ? initiatorId : offerInitial.merchantId;

    if (actualSellerId === actualBuyerId) {
      throw new Error('You cannot trade on your own ad.');
    }

    return await db.withLocks(
      [`offer:${offerId}`, `user:${actualSellerId}`, `user:${actualBuyerId}`],
      async () => {
        const offer = db.getOffer(offerId);
        if (!offer) throw new Error('Offer not found.');

        const seller = db.getUser(actualSellerId);
        const buyer = db.getUser(actualBuyerId);
        if (!seller || !buyer) {
          throw new Error('User account not found.');
        }

        // MANDATORY KYC FOR ALL USERS (Buyers & Sellers)
        const initiator = db.getUser(initiatorId);
        if (!initiator || initiator.kycStatus !== 'VERIFIED') {
          throw new Error(
            'Identity verification (KYC) is required for all users before trading. Please verify your ID on the website or via @fetanp2probot.'
          );
        }
        if (buyer.kycStatus !== 'VERIFIED' || seller.kycStatus !== 'VERIFIED') {
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

        // If the seller provided a payout account number during order creation, save it to their profile
        if (sellerAccountNumber && sellerAccountNumber.trim()) {
          const meta = PAYMENT_METHODS_META[paymentMethod];
          const updatedDetails = { ...(seller.paymentDetails || {}) };
          if (meta) {
            updatedDetails[meta.accountField] = sellerAccountNumber.trim();
          }
          db.updateUser(seller.id, { paymentDetails: updatedDetails });
        }

        // Lock seller USDT atomically
        const newSellerBalance = Number((seller.usdtBalance - usdtAmount).toFixed(6));
        const newSellerLocked = Number((seller.usdtLocked + usdtAmount).toFixed(6));
        db.updateUser(seller.id, {
          usdtBalance: newSellerBalance,
          usdtLocked: newSellerLocked,
        });

        // Deduct from offer supply
        db.updateOffer(offer.id, {
          totalAvailable: Number(Math.max(0, offer.totalAvailable - usdtAmount).toFixed(4)),
        });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15-minute payment window
        const orderId = db.nextOrderId();

        const updatedSeller = db.getUser(seller.id) || seller;
        const paymentDetails = resolveSellerPaymentDetails(
          updatedSeller,
          paymentMethod,
          sellerAccountNumber,
          sellerAccountName
        );
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

        db.saveOrder(order);

        // Initial system message in trade chat
        db.addChatMessage({
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
          db.addChatMessage({
            id: `msg-${Date.now()}-terms`,
            orderId,
            senderId: offer.merchantId,
            senderName: displayName(offer.merchantName),
            senderRole: 'MERCHANT',
            text: `Merchant terms: ${offer.terms}`,
            timestamp: new Date(now.getTime() + 400).toISOString(),
          });
        }

        wsGateway.emitToUser(actualSellerId, 'balance_updated', {
          usdtBalance: newSellerBalance,
          usdtLocked: newSellerLocked,
        });
        wsGateway.emitToRoom(`trade:${orderId}`, 'escrow_locked', order);
        void telegramBot.sendOrderNotification(order, 'CREATED');

        return order;
      }
    );
  }

  /**
   * 2. BUYER MARKS ORDER AS PAID (PENDING_PAYMENT -> PAYMENT_SENT)
   */
  async confirmPayment(
    orderId: string,
    actorId: string,
    proofReceiptUrl?: string
  ): Promise<P2POrder> {
    return await db.withOrderLock(orderId, async (order) => {
      const actor = db.getUser(actorId);
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

      const updatedLogs = [
        ...order.auditLogs,
        {
          id: `log-${Date.now()}`,
          timestamp: now.toISOString(),
          message: `Buyer marked ${order.etbAmount.toLocaleString()} ETB as paid via ${methodShortName}.${cleanRef ? ` Reference: ${cleanRef}` : ''}`,
          actor: 'BUYER' as const,
        },
      ];

      const updatedOrder: P2POrder = {
        ...order,
        status: 'PAYMENT_SENT',
        paidAt: now.toISOString(),
        proofReceiptUrl: cleanRef || order.proofReceiptUrl,
        auditLogs: updatedLogs,
        updatedAt: now.toISOString(),
      };

      db.saveOrder(updatedOrder);

      db.addChatMessage({
        id: `msg-${Date.now()}`,
        orderId,
        senderId: 'SYSTEM',
        senderName: 'Fetan Escrow',
        senderRole: 'ADMIN',
        text: `Buyer marked ${order.etbAmount.toLocaleString()} ETB as paid.${cleanRef ? ` Payment ref: ${cleanRef}.` : ''} ${displayName(order.sellerName)}, please check your ${methodShortName} account and click "Confirm & Complete Order" once you receive the money.`,
        timestamp: now.toISOString(),
        isSystem: true,
      });

      wsGateway.emitToRoom(`trade:${orderId}`, 'payment_confirmed', updatedOrder);
      wsGateway.emitToUser(order.sellerId, 'payment_alert', {
        orderId,
        etbAmount: order.etbAmount,
      });
      void telegramBot.sendOrderNotification(updatedOrder, 'PAID');

      return updatedOrder;
    });
  }

  /**
   * 3. COMPLETE ORDER & RELEASE ESCROW TO BUYER (Seller or Admin)
   */
  async releaseEscrow(orderId: string, actorId: string, note?: string): Promise<P2POrder> {
    const existingOrder = db.getOrder(orderId);
    if (!existingOrder) throw new Error('Order not found.');

    return await db.withLocks(
      [`order:${orderId}`, `user:${existingOrder.sellerId}`, `user:${existingOrder.buyerId}`],
      async () => {
        const order = db.getOrder(orderId);
        if (!order) throw new Error('Order not found.');

        const actor = db.getUser(actorId);
        const isAdmin = isAdminRole(actor?.role);

        if (order.sellerId !== actorId && !isAdmin) {
          throw new Error('Only the seller or an admin can release USDT and complete the order.');
        }
        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
          throw new Error(`This order is already ${order.status.toLowerCase()}.`);
        }

        // Seller cannot release before buyer marks payment as sent
        if (!isAdmin && order.status === 'PENDING_PAYMENT') {
          throw new Error('Wait for the buyer to mark the order as paid before releasing USDT.');
        }

        const seller = db.getUser(order.sellerId);
        const buyer = db.getUser(order.buyerId);
        if (!seller || !buyer) {
          throw new Error('Order participant account not found.');
        }

        const deductLocked = Math.min(seller.usdtLocked, order.usdtAmount);
        const newSellerLocked = Number(Math.max(0, seller.usdtLocked - deductLocked).toFixed(6));
        const newBuyerBalance = Number((buyer.usdtBalance + order.usdtAmount).toFixed(6));

        db.updateUser(seller.id, {
          usdtLocked: newSellerLocked,
          completedTrades: (seller.completedTrades || 0) + 1,
        });
        db.updateUser(buyer.id, {
          usdtBalance: newBuyerBalance,
          completedTrades: (buyer.completedTrades || 0) + 1,
        });

        const now = new Date();
        const isReleasedByAdmin = isAdmin && order.sellerId !== actorId;
        const cleanNote = note?.trim();

        const releasedByMsg = isReleasedByAdmin
          ? `Admin (${displayName(actor?.name)}) completed the order and released ${order.usdtAmount.toFixed(2)} USDT to ${displayName(buyer.name)}.${cleanNote ? ` Note: ${cleanNote}` : ''}`
          : `Seller confirmed receiving ${order.etbAmount.toLocaleString()} ETB and released ${order.usdtAmount.toFixed(2)} USDT to ${displayName(buyer.name)}.`;

        const updatedLogs = [
          ...order.auditLogs,
          {
            id: `log-${Date.now()}`,
            timestamp: now.toISOString(),
            message: releasedByMsg,
            actor: isReleasedByAdmin ? ('ADMIN' as const) : ('SELLER' as const),
          },
        ];

        const updatedOrder: P2POrder = {
          ...order,
          status: 'COMPLETED',
          completedAt: now.toISOString(),
          resolvedBy: isReleasedByAdmin ? displayName(actor?.name) : order.resolvedBy,
          resolutionNote: cleanNote || order.resolutionNote,
          auditLogs: updatedLogs,
          updatedAt: now.toISOString(),
        };

        db.saveOrder(updatedOrder);

        db.addChatMessage({
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

        wsGateway.emitToRoom(`trade:${orderId}`, 'escrow_released', updatedOrder);
        wsGateway.emitToUser(seller.id, 'balance_updated', {
          usdtBalance: seller.usdtBalance,
          usdtLocked: newSellerLocked,
        });
        wsGateway.emitToUser(buyer.id, 'balance_updated', {
          usdtBalance: newBuyerBalance,
          usdtLocked: buyer.usdtLocked,
        });
        void telegramBot.sendOrderNotification(updatedOrder, 'COMPLETED');

        return updatedOrder;
      }
    );
  }

  /**
   * 4. CANCEL ORDER & RETURN LOCKED USDT TO SELLER (Buyer or Admin)
   */
  async cancelEscrow(orderId: string, actorId: string, reason?: string): Promise<P2POrder> {
    const existingOrder = db.getOrder(orderId);
    if (!existingOrder) throw new Error('Order not found.');

    return await db.withLocks(
      [`order:${orderId}`, `user:${existingOrder.sellerId}`, `offer:${existingOrder.offerId}`],
      async () => {
        const order = db.getOrder(orderId);
        if (!order) throw new Error('Order not found.');

        const actor = db.getUser(actorId);
        const isAdmin = isAdminRole(actor?.role);

        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
          throw new Error(`This order is already ${order.status.toLowerCase()}.`);
        }

        if (!isAdmin) {
          if (order.buyerId !== actorId) {
            throw new Error('Only the buyer or an admin can cancel this order.');
          }
          if (order.status === 'DISPUTED') {
            throw new Error('This order is under support review. Only an admin or buyer resolution can close it.');
          }
        }

        const seller = db.getUser(order.sellerId);
        if (!seller) throw new Error('Seller account not found.');

        const unlockAmount = Math.min(seller.usdtLocked, order.usdtAmount);
        const newSellerLocked = Number(Math.max(0, seller.usdtLocked - unlockAmount).toFixed(6));
        const newSellerBalance = Number((seller.usdtBalance + order.usdtAmount).toFixed(6));

        db.updateUser(seller.id, {
          usdtBalance: newSellerBalance,
          usdtLocked: newSellerLocked,
        });

        // Restore offer available USDT
        const offer = db.getOffer(order.offerId);
        if (offer) {
          db.updateOffer(offer.id, {
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

        db.saveOrder(updatedOrder);

        db.addChatMessage({
          id: `msg-${Date.now()}`,
          orderId,
          senderId: 'SYSTEM',
          senderName: 'Fetan Escrow',
          senderRole: 'ADMIN',
          text: cancelMsg,
          timestamp: now.toISOString(),
          isSystem: true,
        });

        wsGateway.emitToRoom(`trade:${orderId}`, 'escrow_released', updatedOrder);
        wsGateway.emitToUser(seller.id, 'balance_updated', {
          usdtBalance: newSellerBalance,
          usdtLocked: newSellerLocked,
        });
        void telegramBot.sendOrderNotification(updatedOrder, 'CANCELLED');

        return updatedOrder;
      }
    );
  }

  /**
   * 5. OPEN APPEAL / DISPUTE (Buyer or Seller asks Admin to step in)
   */
  async disputeTrade(orderId: string, userId: string, reason: string): Promise<P2POrder> {
    return await db.withOrderLock(orderId, async (order) => {
      const actor = db.getUser(userId);
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

      const updatedOrder: P2POrder = {
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

      db.saveOrder(updatedOrder);

      db.addChatMessage({
        id: `msg-${Date.now()}`,
        orderId,
        senderId: 'SYSTEM',
        senderName: 'Fetan Support',
        senderRole: 'ADMIN',
        text: `Appeal opened by ${roleLabel}: "${cleanReason}". A Fetan Admin is reviewing this order. Please share any payment details or screenshots in the chat.`,
        timestamp: now.toISOString(),
        isSystem: true,
      });

      wsGateway.emitToRoom('admin:dashboard', 'dispute_alert', updatedOrder);
      wsGateway.emitToRoom(`trade:${orderId}`, 'dispute_alert', updatedOrder);
      telegramBot.sendDisputeAlert(updatedOrder);

      return updatedOrder;
    });
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
    return await db.withOrderLock(orderId, async (order) => {
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

      const updatedOrder: P2POrder = {
        ...order,
        buyerFeedback: isBuyer ? feedback : order.buyerFeedback,
        sellerFeedback: isSeller ? feedback : order.sellerFeedback,
        updatedAt: new Date().toISOString(),
      };

      db.saveOrder(updatedOrder);
      return updatedOrder;
    });
  }
}

export const escrowController = new EscrowController();
