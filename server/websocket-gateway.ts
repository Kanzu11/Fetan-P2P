import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';

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

    wss.on('connection', (ws: WebSocket, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const userId = url.searchParams.get('userId');
      const orderId = url.searchParams.get('orderId');
      const role = url.searchParams.get('role');

      // Auto-join default rooms based on handshake params
      if (userId) this.joinRoom(`user:${userId}`, ws);
      if (orderId) this.joinRoom(`trade:${orderId}`, ws);
      if (role === 'ADMIN' || role === 'SUPERADMIN') this.joinRoom('admin:dashboard', ws);

      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.action === 'join_room' && parsed.room) {
            this.joinRoom(parsed.room, ws);
          } else if (parsed.action === 'leave_room' && parsed.room) {
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
    // 1. Emit to WebSocket clients
    const clients = this.roomSubscriptions.get(room);
    if (clients) {
      const message = JSON.stringify({ event, room, data: payload, timestamp: new Date().toISOString() });
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }

    // 2. Emit to internal bus for server-side / SSE / in-memory subscribers
    this.bus.emit('event', { room, event, data: payload });
    this.bus.emit(room, { event, data: payload });
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.emitToRoom(`user:${userId}`, event, payload);
  }

  // Subscribe internally (used by Next.js API route streams or server listeners)
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
