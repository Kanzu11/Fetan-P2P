import { pricingService } from '@/client/pricing';
import { wsGateway } from '@/server/websocket-gateway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastStatsJson = '';

      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const sendComment = (comment: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${comment}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const initialStats = await pricingService.getLiveStats();
        lastStatsJson = JSON.stringify(initialStats);
        sendEvent('price_updated', {
          stats: initialStats,
          source: 'initial',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Initial live price stream error:', err);
      }

      const unsubscribe = wsGateway.onAnyEvent((evt) => {
        if (
          (evt.room === 'public:prices' || evt.room === 'public') &&
          evt.event === 'price_updated'
        ) {
          const payload = evt.data as { stats?: unknown } | undefined;
          if (payload?.stats) {
            lastStatsJson = JSON.stringify(payload.stats);
          }
          sendEvent('price_updated', {
            ...(typeof evt.data === 'object' && evt.data !== null ? evt.data : { stats: evt.data }),
            source: 'realtime',
            timestamp: new Date().toISOString(),
          });
        }
      });

      const keepAliveTimer = setInterval(() => {
        sendComment('ping');
      }, 15000);

      const syncTimer = setInterval(async () => {
        if (closed) return;
        try {
          const freshStats = await pricingService.getLiveStats();
          const freshJson = JSON.stringify(freshStats);
          if (freshJson !== lastStatsJson) {
            lastStatsJson = freshJson;
            sendEvent('price_updated', {
              stats: freshStats,
              source: 'sync',
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Transient DB timeout ignored until next cycle
        }
      }, 20000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAliveTimer);
        clearInterval(syncTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
