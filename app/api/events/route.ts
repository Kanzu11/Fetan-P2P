import { wsGateway } from '@/server/websocket-gateway';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const orderId = searchParams.get('orderId');
  const role = searchParams.get('role');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection ping
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() })}\n\n`)
      );

      const handleEvent = ({ room, event, data }: { room: string; event: string; data: unknown }) => {
        // Filter whether this client should receive this event
        const isUserMatch = userId && room === `user:${userId}`;
        const isTradeMatch = orderId && room === `trade:${orderId}`;
        const isAdminMatch = (role === 'ADMIN' || role === 'SUPERADMIN') && room === 'admin:dashboard';

        if (isUserMatch || isTradeMatch || isAdminMatch || room === 'public') {
          try {
            const payload = JSON.stringify({ room, event, data, timestamp: new Date().toISOString() });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } catch {
            // Stream may have closed
          }
        }
      };

      const unsubscribe = wsGateway.onAnyEvent(handleEvent);

      // Heartbeat every 20s
      const timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(timer);
          unsubscribe();
        }
      }, 20000);

      req.signal.addEventListener('abort', () => {
        clearInterval(timer);
        unsubscribe();
      });
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
