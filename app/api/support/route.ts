import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/database/store';
import { requireAuth, requireAdmin } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';
import { sanitizeString } from '@/server/security/sanitize';
import { telegramBot } from '@/server/telegram-bot';
import { emailService } from '@/server/email-service';
import { wsGateway } from '@/server/websocket-gateway';
import { isAdminRole, type SupportTicket } from '@/client/types';

export const dynamic = 'force-dynamic';

const createTicketSchema = z.object({
  action: z.literal('CREATE').optional(),
  orderId: z.string().max(64).optional(),
  category: z.enum(['ORDER_COMPLAINT', 'PAYMENT_ISSUE', 'KYC_HELP', 'GENERAL_SUPPORT']),
  subject: z.string().min(3).max(120),
  message: z.string().min(5, 'Please provide details about your request.').max(2000),
  source: z.enum(['WEB', 'TELEGRAM_BOT', 'MINI_APP']).default('WEB'),
});

const resolveTicketSchema = z.object({
  action: z.literal('RESOLVE'),
  ticketId: z.string().min(1),
  adminReply: z.string().min(2).max(1500),
});

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const allTickets = await db.getSupportTickets();
  const tickets = isAdminRole(auth.user.role)
    ? allTickets
    : allTickets.filter((t) => t.userId === auth.user.id);

  return NextResponse.json({ tickets });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const rawBody = await req.json();

    if (rawBody?.action === 'RESOLVE') {
      const adminCheck = await requireAdmin(req);
      if (!adminCheck.ok) return adminCheck.response;

      const parsed = resolveTicketSchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'Invalid resolve payload.' },
          { status: 400 }
        );
      }

      const existing = await db.getSupportTicket(parsed.data.ticketId);
      if (!existing) {
        return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
      }

      const updated: SupportTicket = {
        ...existing,
        status: 'RESOLVED',
        adminReply: sanitizeString(parsed.data.adminReply, 1200),
        resolvedBy: adminCheck.user.id,
        updatedAt: new Date().toISOString(),
      };

      await db.saveSupportTicket(updated);
      wsGateway.emitToUser(existing.userId, 'support_ticket_updated', { ticket: updated });
      wsGateway.emitToRoom('admin:dashboard', 'support_ticket_updated', { ticket: updated });

      return NextResponse.json({ success: true, ticket: updated });
    }

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`support:${auth.user.id}:${ip}`, 5, 900);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Support rate limit exceeded. Please wait before opening another ticket.'
      );
    }

    const parsed = createTicketSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid support ticket payload.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const ticket: SupportTicket = {
      id: `tkt-${crypto.randomUUID()}`,
      userId: auth.user.id,
      userName: auth.user.name,
      userEmail: auth.user.email,
      telegramHandle: auth.user.telegramHandle,
      orderId: sanitizeString(parsed.data.orderId, 60) || undefined,
      category: parsed.data.category,
      subject: sanitizeString(parsed.data.subject, 120),
      message: sanitizeString(parsed.data.message, 1800),
      status: 'OPEN',
      source: parsed.data.source,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await db.saveSupportTicket(ticket);

    await db.logAudit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'SUPPORT_TICKET_CREATED',
      targetType: 'SupportTicket',
      targetId: saved.id,
      ip,
      details: { category: saved.category, orderId: saved.orderId },
    });

    await telegramBot.sendSupportTicketAlert(saved);
    if (emailService.isConfigured() && process.env.ADMIN_EMAIL) {
      void emailService
        .sendEmail(
          process.env.ADMIN_EMAIL,
          `[Fetan Support] ${saved.subject} (${saved.category})`,
          `From: ${saved.userName} (${saved.userEmail})\nOrder ID: ${saved.orderId || 'N/A'}\n\n${saved.message}`
        )
        .catch(() => {});
    }

    wsGateway.emitToRoom('admin:dashboard', 'support_ticket_created', { ticket: saved });

    return NextResponse.json({
      success: true,
      ticket: saved,
      message: 'Support ticket submitted. An admin will respond shortly.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Support request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
