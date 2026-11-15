import { NextResponse } from 'next/server';
import { z } from 'zod';
import { emailService, verifyEmailRelaySignature } from '@/server/email-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const relaySchema = z.object({
  from: z.string().max(160).optional(),
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100_000),
});

export async function POST(req: Request) {
  try {
    const timestamp = req.headers.get('x-fetan-timestamp') || '';
    const signature = req.headers.get('x-fetan-signature') || '';
    const rawBody = await req.text();

    const sigCheck = verifyEmailRelaySignature(timestamp, rawBody, signature);
    if (!sigCheck.valid) {
      return NextResponse.json(
        { error: sigCheck.error || 'Unauthorized email relay request.' },
        { status: 401 }
      );
    }

    const parsed = relaySchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email relay payload.' }, { status: 400 });
    }

    await emailService.sendDirectSmtp(parsed.data);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Vercel SMTP email relay error:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'SMTP relay failed. Ensure EMAIL_USER, EMAIL_PASS, and JWT_SECRET are set on Vercel.',
      },
      { status: 502 }
    );
  }
}
