import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uploadService, type UploadFolder } from '@/server/upload-service';
import { requireAuth } from '@/server/security/session';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';

const jsonUploadSchema = z.object({
  dataUri: z.string().min(10, 'Invalid base64 image payload'),
  folder: z.enum(['kyc', 'receipts', 'general']).default('general'),
});

const VALID_FOLDERS = new Set<UploadFolder>(['kyc', 'receipts', 'general']);

function normalizeFolder(input: unknown): UploadFolder {
  if (typeof input === 'string' && VALID_FOLDERS.has(input as UploadFolder)) {
    return input as UploadFolder;
  }
  return 'general';
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const ip = getClientIp(req);
    const limit = await rateLimiter.checkAsync(`upload:${auth.user.id}:${ip}`, 20, 60);
    if (!limit.allowed) {
      return rateLimiter.rateLimitResponse(
        limit.resetSeconds,
        'Upload rate limit exceeded. Please wait before uploading more files.'
      );
    }

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const folder = normalizeFolder(formData.get('folder'));

      if (!file) {
        return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
      }

      if (file.size > 8 * 1024 * 1024) {
        return NextResponse.json({ error: 'File exceeds maximum 8 MB upload limit' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = await uploadService.uploadBuffer(buffer, folder, auth.user.id);

      return NextResponse.json({
        success: true,
        id: result.id,
        url: result.url,
        filename: result.filename,
        size: result.size,
        format: result.format,
        mimeType: result.mimeType,
      });
    }

    const body = await req.json();
    const parsed = jsonUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid upload payload' },
        { status: 400 }
      );
    }

    const result = await uploadService.uploadDataUri(
      parsed.data.dataUri,
      parsed.data.folder,
      auth.user.id
    );

    return NextResponse.json({
      success: true,
      id: result.id,
      url: result.url,
      filename: result.filename,
      size: result.size,
      format: result.format,
      mimeType: result.mimeType,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    const isValidation =
      message.includes('Unsupported') ||
      message.includes('empty') ||
      message.includes('exceeds') ||
      message.includes('Invalid');
    return NextResponse.json({ error: message }, { status: isValidation ? 400 : 500 });
  }
}
