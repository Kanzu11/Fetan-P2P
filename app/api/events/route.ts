import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { requireAuth } from '@/server/security/session';
import { wsGateway } from '@/server/websocket-gateway';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const requestedOrderId = searchParams.get('orderId')?.trim();

  const isAdmin = isAdminRole(auth.user.role);
  let allowedOrderId: string | null = null;

  if (requestedOrderId) {
    const order = await db.getOrder(requestedOrderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (order.buyerId !== auth.user.id && order.sellerId !== auth.user.id && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: cannot subscribe to events for this order.' },
        { status: 403 }
      );
    }
    allowedOrderId = order.id;
  }

  const encoder = new TextEncoder();
  const userId = auth.user.id;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const handleEvent = ({ room, event, data }: { room: string; event: string; data: unknown }) => {
        const isUserMatch = room === `user:${userId}`;
        const isTradeMatch = allowedOrderId !== null && room === `trade:${allowedOrderId}`;
        const isAdminMatch = isAdmin && room === 'admin:dashboard';

        if (isUserMatch || isTradeMatch || isAdminMatch || room === 'public') {
          const payload = JSON.stringify({
            room,
            event,
            data,
            timestamp: new Date().toISOString(),
          });
          safeEnqueue(`data: ${payload}\n\n`);
        }
      };

      const unsubscribe = wsGateway.onAnyEvent(handleEvent);
      const timer = setInterval(() => {
        safeEnqueue(`: ping\n\n`);
      }, 20000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        unsubscribe();
      };

      req.signal.addEventListener('abort', cleanup);

      safeEnqueue(
        `data: ${JSON.stringify({ event: 'connected', userId, timestamp: new Date().toISOString() })}\n\n`
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
