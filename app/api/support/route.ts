import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { telegramBot } from '@/server/telegram-bot';
import { wsGateway } from '@/server/websocket-gateway';
import { SupportTicket } from '@/lib/types';

export async function GET() {
  return NextResponse.json({
    tickets: db.getSupportTickets(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      action,
      ticketId,
      adminReply,
      resolvedBy,
      userId,
      orderId,
      category,
      subject,
      message,
      source,
    } = body;

    if (action === 'RESOLVE' && ticketId) {
      const existing = db.getSupportTicket(ticketId);
      if (!existing) {
        return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 });
      }
      const updated: SupportTicket = {
        ...existing,
        status: 'RESOLVED',
        adminReply: (adminReply || 'Resolved by Fetan Support.').slice(0, 1000),
        resolvedBy: resolvedBy || '@kanzedin',
        updatedAt: new Date().toISOString(),
      };
      db.saveSupportTicket(updated);

      const user = db.getUser(existing.userId);
      if (user?.telegramChatId) {
        void telegramBot.sendTelegramMessage(
          user.telegramChatId,
          `✅ <b>Support Ticket Resolved (#${updated.id})</b>\n\n` +
            `<b>Subject:</b> ${updated.subject}\n` +
            `<b>Admin Reply:</b> ${updated.adminReply}`
        );
      }

      wsGateway.emitToRoom('admin:dashboard', 'support_ticket_updated', updated);
      return NextResponse.json({ success: true, ticket: updated });
    }

    if (!userId || !message?.trim()) {
      return NextResponse.json({ error: 'Please enter a message for support.' }, { status: 400 });
    }

    // Input sanitization & size limits
    const cleanMessage = String(message).trim().slice(0, 2000);
    const cleanSubject = String(subject || (orderId ? `Order #${orderId} Complaint` : 'Support Request'))
      .trim()
      .slice(0, 150);

    const user = db.getUser(userId);
    const now = new Date().toISOString();

    const ticket: SupportTicket = {
      id: `sup-${Date.now().toString(36)}`,
      userId,
      userName: user?.name || 'Fetan Trader',
      userEmail: user?.email || 'user@fetan.et',
      telegramHandle: user?.telegramHandle,
      orderId: orderId?.trim()?.slice(0, 50) || undefined,
      category: category || (orderId ? 'ORDER_COMPLAINT' : 'GENERAL_SUPPORT'),
      subject: cleanSubject,
      message: cleanMessage,
      status: 'OPEN',
      source: source || 'WEB',
      createdAt: now,
      updatedAt: now,
    };

    db.saveSupportTicket(ticket);
    wsGateway.emitToRoom('admin:dashboard', 'new_support_ticket', ticket);
    void telegramBot.sendSupportTicketAlert(ticket);

    return NextResponse.json({
      success: true,
      ticket,
      message: 'Your message was sent to Superadmin @kanzedin via Telegram and email.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
