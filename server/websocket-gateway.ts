import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import {
  SESSION_COOKIE_NAME,
  parseCookieHeader,
  verifySessionToken,
} from './security/session';
import { db } from './database/store';

export type WsRoom = `user:${string}` | `trade:${string}` | 'admin:dashboard';

class WebSocketGateway {
  private wss: WebSocketServer | null = null;
  private roomSubscriptions: Map<string, Set<WebSocket>> = new Map();
  private bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(100);
  }

  attachServer(wss: WebSocketServer) {
    this.wss = wss;

    wss.on('connection', async (ws: WebSocket, req) => {
      const token = parseCookieHeader(req.headers.cookie, SESSION_COOKIE_NAME);
      const session = verifySessionToken(token);

      if (!session) {
        ws.close(4001, 'Authentication required');
        return;
      }

      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const orderId = url.searchParams.get('orderId');

      this.joinRoom(`user:${session.sub}`, ws);

      if (session.role === 'ADMIN' || session.role === 'SUPERADMIN') {
        this.joinRoom('admin:dashboard', ws);
      }

      if (orderId) {
        const order = await db.getOrder(orderId);
        const isParticipant =
          order &&
          (order.buyerId === session.sub ||
            order.sellerId === session.sub ||
            session.role === 'ADMIN' ||
            session.role === 'SUPERADMIN');
        if (isParticipant) {
          this.joinRoom(`trade:${orderId}`, ws);
        }
      }

      ws.on('message', async (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.action === 'join_room' && typeof parsed.room === 'string') {
            const room: string = parsed.room;
            if (room === `user:${session.sub}`) {
              this.joinRoom(room, ws);
            } else if (
              room === 'admin:dashboard' &&
              (session.role === 'ADMIN' || session.role === 'SUPERADMIN')
            ) {
              this.joinRoom(room, ws);
            } else if (room.startsWith('trade:')) {
              const targetOrderId = room.slice('trade:'.length);
              const order = await db.getOrder(targetOrderId);
              if (
                order &&
                (order.buyerId === session.sub ||
                  order.sellerId === session.sub ||
                  session.role === 'ADMIN' ||
                  session.role === 'SUPERADMIN')
              ) {
                this.joinRoom(room, ws);
              }
            }
          } else if (parsed.action === 'leave_room' && typeof parsed.room === 'string') {
            this.leaveRoom(parsed.room, ws);
          }
        } catch {
          // ignore malformed payloads
        }
      });

      ws.on('close', () => {
        this.roomSubscriptions.forEach((clients) => clients.delete(ws));
      });
    });
  }

  joinRoom(room: string, ws: WebSocket) {
    if (!this.roomSubscriptions.has(room)) {
      this.roomSubscriptions.set(room, new Set());
    }
    this.roomSubscriptions.get(room)!.add(ws);
  }

  leaveRoom(room: string, ws: WebSocket) {
    this.roomSubscriptions.get(room)?.delete(ws);
  }

  emitToRoom(room: string, event: string, payload: unknown) {
    const clients = this.roomSubscriptions.get(room);
    if (clients) {
      const message = JSON.stringify({
        event,
        room,
        data: payload,
        timestamp: new Date().toISOString(),
      });
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }

    this.bus.emit('event', { room, event, data: payload });
    this.bus.emit(room, { event, data: payload });
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.emitToRoom(`user:${userId}`, event, payload);
  }

  onRoomEvent(room: string, listener: (data: { event: string; data: unknown }) => void) {
    this.bus.on(room, listener);
    return () => this.bus.off(room, listener);
  }

  onAnyEvent(listener: (data: { room: string; event: string; data: unknown }) => void) {
    this.bus.on('event', listener);
    return () => this.bus.off('event', listener);
  }
}

const globalForWs = global as unknown as { wsGateway?: WebSocketGateway };
export const wsGateway = globalForWs.wsGateway || new WebSocketGateway();
if (process.env.NODE_ENV !== 'production') globalForWs.wsGateway = wsGateway;
