import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { sanitizeString } from '@/server/security/sanitize';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { wsGateway } from '@/server/websocket-gateway';
import { displayName, isAdminRole, type ChatMessage } from '@/client/types';

export const dynamic = 'force-dynamic';

const chatPostSchema = z.object({
  text: z.string().max(1500).optional(),
  imageUrl: z.string().max(500).optional(),
  type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
});

function isAllowedReceiptUrl(url: string): boolean {
  return url.startsWith('/api/uploads/') || url.startsWith('https://');
}

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const order = await db.getOrder(context.params.id);
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const isParticipant = order.buyerId === auth.user.id || order.sellerId === auth.user.id;
  if (!isParticipant && !isAdminRole(auth.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const messages = await db.getChatMessages(order.id);
  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`chat:${auth.user.id}:${ip}`, 40, 60);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(limit.resetSeconds, 'Too many chat messages sent.');
    }

    const order = await db.getOrder(context.params.id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const isBuyer = order.buyerId === auth.user.id;
    const isSeller = order.sellerId === auth.user.id;
    const isAdmin = isAdminRole(auth.user.role);

    if (!isBuyer && !isSeller && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden: not a participant in this trade.' }, { status: 403 });
    }

    const rawBody = await req.json();
    const parsed = chatPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid chat message' },
        { status: 400 }
      );
    }

    const cleanText = sanitizeString(parsed.data.text, 1200);
    const cleanImageUrl = parsed.data.imageUrl?.trim();

    if (!cleanText && !cleanImageUrl) {
      return NextResponse.json(
        { error: 'Message text or image attachment is required.' },
        { status: 400 }
      );
    }

    if (cleanImageUrl && !isAllowedReceiptUrl(cleanImageUrl)) {
      return NextResponse.json(
        { error: 'Image URL must originate from platform upload (/api/uploads/...) or HTTPS.' },
        { status: 400 }
      );
    }

    const senderRole: ChatMessage['senderRole'] =
      !isBuyer && !isSeller && isAdmin ? 'ADMIN' : auth.user.role;

    const msg: ChatMessage = {
      id: `msg-${crypto.randomUUID()}`,
      orderId: order.id,
      senderId: auth.user.id,
      senderName: displayName(auth.user),
      senderRole,
      text: cleanText || 'Uploaded attachment',
      imageUrl: cleanImageUrl || undefined,
      type: cleanImageUrl ? 'IMAGE' : parsed.data.type,
      timestamp: new Date().toISOString(),
    };

    const savedMsg = await db.addChatMessage(msg);

    if (
      cleanImageUrl &&
      isBuyer &&
      (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_SENT')
    ) {
      await db.withOrderLock(order.id, async (lockedOrder) => {
        if (!lockedOrder.proofReceiptUrl) {
          await db.saveOrder({
            ...lockedOrder,
            proofReceiptUrl: cleanImageUrl,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }

    wsGateway.emitToRoom(`trade:${order.id}`, 'chat_message', savedMsg);

    const recipientId = isBuyer ? order.sellerId : isSeller ? order.buyerId : undefined;
    if (recipientId) {
      wsGateway.emitToUser(recipientId, 'chat_message', { orderId: order.id, message: savedMsg });
    }

    return NextResponse.json({ success: true, message: savedMsg });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send chat message';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
