import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { wsGateway } from '@/server/websocket-gateway';
import { ChatMessage } from '@/client/types';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const messages = db.getChatMessages(params.id);
  return NextResponse.json({ messages });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { senderId, text, imageUrl, type } = await req.json();
    if (!senderId || (!text && !imageUrl)) {
      return NextResponse.json({ error: 'senderId and text or imageUrl are required' }, { status: 400 });
    }

    const user = db.getUser(senderId);
    const order = db.getOrder(params.id);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const messageType = imageUrl ? 'IMAGE' : (type || 'TEXT');
    const messageText = text?.trim() || (imageUrl ? 'Receipt / Image attachment' : '');

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      orderId: params.id,
      senderId,
      senderName: user ? user.name : 'Participant',
      senderRole: user ? user.role : 'USER',
      text: messageText,
      imageUrl: imageUrl || undefined,
      type: messageType,
      timestamp: new Date().toISOString()
    };

    db.addChatMessage(message);

    // If an image receipt was uploaded by the buyer, update the order's proofReceiptUrl
    if (imageUrl && senderId === order.buyerId && !order.proofReceiptUrl) {
      db.saveOrder({
        ...order,
        proofReceiptUrl: imageUrl,
        updatedAt: new Date().toISOString()
      });
    }

    // Broadcast message to trade room
    wsGateway.emitToRoom(`trade:${params.id}`, 'chat_message', message);

    return NextResponse.json({ success: true, message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
