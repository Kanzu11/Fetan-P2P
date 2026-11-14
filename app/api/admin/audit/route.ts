import { NextResponse } from 'next/server';
import { prisma } from '@/server/database/prisma';
import { requireAdmin } from '@/server/security/session';

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({
      logs: logs.map((l) => ({
        id: l.id,
        actorId: l.actorId,
        actorRole: l.actorRole,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        ip: l.ip,
        details: l.details,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load audit logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
