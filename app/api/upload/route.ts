import { NextResponse } from 'next/server';
import { uploadService, UploadFolder } from '@/server/upload-service';
import { rateLimiter, getClientIp } from '@/server/security/rate-limiter';

export const dynamic = 'force-dynamic';

function normalizeFolder(inputFolder?: string | null): UploadFolder {
  if (!inputFolder) return 'general';
  if (inputFolder.includes('kyc')) return 'kyc';
  if (inputFolder.includes('receipt')) return 'receipts';
  return 'general';
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);

    // Rate limit: 15 uploads per minute per IP
    const limitCheck = rateLimiter.check(`upload:${ip}`, 15, 60);
    if (!limitCheck.allowed) {
      return rateLimiter.rateLimitResponse(
        limitCheck.resetSeconds,
        'Upload rate limit exceeded. Please wait a minute before uploading additional files.'
      );
    }

    const contentType = req.headers.get('content-type') || '';

    // 1. Multipart Form Data (Native <input type="file" />)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const rawFolder = formData.get('folder') as string | null;
      const folder = normalizeFolder(rawFolder);

      if (!file) {
        return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
      }

      // Max 10MB file limit
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'File size exceeds maximum limit of 10MB' }, { status: 400 });
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const result = await uploadService.uploadBuffer(buffer, folder, file.type || 'image/jpeg');

      return NextResponse.json({
        success: true,
        url: result.url,
        filename: result.filename,
        format: result.format,
      });
    }

    // 2. JSON Base64 Payload
    const body = await req.json();
    const { image, folder: rawFolder } = body;
    const folder = normalizeFolder(rawFolder);

    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Missing image string (Data URI / base64 required)' }, { status: 400 });
    }

    const result = await uploadService.uploadDataUri(image, folder);
    return NextResponse.json({
      success: true,
      url: result.url,
      filename: result.filename,
      format: result.format,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

