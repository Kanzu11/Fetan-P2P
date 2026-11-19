import { NextResponse } from 'next/server';
import { prisma } from '@/server/database/prisma';
import { requireAuth } from '@/server/security/session';
import { isAllowedCloudinaryUrl } from '@/server/security/sanitize';
import { isAdminRole } from '@/client/types';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const id = context.params?.id?.trim();
    if (!id) {
      return NextResponse.json({ error: 'File id required' }, { status: 400 });
    }

    const file = await prisma.uploadedFile.findUnique({
      where: { id },
    });

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const isOwner = file.ownerId === auth.user.id;
    const isAdmin = isAdminRole(auth.user.role);
    let isTradeParticipant = false;

    if (!isOwner && !isAdmin && file.folder === 'receipts') {
      const fileUrl = `/api/uploads/${file.id}`;
      const sharedOrder = await prisma.p2POrder.findFirst({
        where: {
          AND: [
            {
              OR: [{ buyerId: auth.user.id }, { sellerId: auth.user.id }],
            },
            {
              OR: [
                { proofReceiptUrl: fileUrl },
                { chatMessages: { some: { imageUrl: fileUrl } } },
              ],
            },
          ],
        },
        select: { id: true },
      });
      isTradeParticipant = Boolean(sharedOrder);
    }

    if (!isOwner && !isAdmin && !isTradeParticipant) {
      return NextResponse.json(
        { error: 'Forbidden: you do not have permission to view this file.' },
        { status: 403 }
      );
    }

    const bodyBuffer = Buffer.from(file.data);
    const maybeUrl = bodyBuffer.toString('utf8');
    if (isAllowedCloudinaryUrl(maybeUrl)) {
      return NextResponse.redirect(maybeUrl, {
        status: 302,
        headers: {
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    const safeMime = file.mimeType.toLowerCase();
    const isSafeInlineImage =
      safeMime === 'image/jpeg' || safeMime === 'image/png' || safeMime === 'image/webp';
    const disposition = isSafeInlineImage ? 'inline' : 'attachment';
    const safeFilename = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    return new Response(bodyBuffer, {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(bodyBuffer.length),
        'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

