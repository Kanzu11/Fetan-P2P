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
    if (Buffer.byteLength(rawBody, 'utf8') > 131_072) {
      return NextResponse.json(
        { error: 'Email relay payload exceeds 128 KB limit.' },
        { status: 413 }
      );
    }

    const sigCheck = verifyEmailRelaySignature(timestamp, rawBody, signature);
    if (!sigCheck.valid) {
      return NextResponse.json(
        { error: sigCheck.error || 'Unauthorized email relay request.' },
        { status: 401 }
      );
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON email relay payload.' }, { status: 400 });
    }

    const parsed = relaySchema.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email relay payload.' }, { status: 400 });
    }

    if (/[\r\n]/.test(parsed.data.to) || /[\r\n]/.test(parsed.data.subject)) {
      return NextResponse.json(
        { error: 'Invalid newline characters in email header fields.' },
        { status: 400 }
      );
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
