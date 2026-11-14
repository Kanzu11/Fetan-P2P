import crypto from 'crypto';
import { prisma } from './database/prisma';

export type UploadFolder = 'kyc' | 'receipts' | 'general';

export interface StoredUploadResult {
  id: string;
  url: string;
  filename: string;
  size: number;
  format: string;
  mimeType: string;
  storage: 'cloudinary' | 'database';
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB max per upload
const ALLOWED_FOLDERS = new Set<UploadFolder>(['kyc', 'receipts', 'general']);

export function signCloudinaryUploadParams(
  folder: string,
  publicId: string,
  timestamp: string,
  apiSecret: string
): string {
  const signaturePayload = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  return crypto.createHash('sha1').update(signaturePayload).digest('hex');
}

export function isCloudinaryConfigured(): boolean {
  if (process.env.CLOUDINARY_DISABLE === 'true') return false;
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim()
  );
}

async function uploadBufferToCloudinary(
  buffer: Buffer,
  folder: UploadFolder,
  ext: string,
  mimeType: string
): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY!.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET!.trim();

  const cloudFolder = `fetan-p2p/${folder}`;
  const publicId = `${folder}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signCloudinaryUploadParams(cloudFolder, publicId, timestamp, apiSecret);

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    `${publicId}.${ext}`
  );
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp);
  formData.append('folder', cloudFolder);
  formData.append('public_id', publicId);
  formData.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: formData,
  });

  const payload = (await res.json()) as {
    secure_url?: string;
    error?: { message?: string };
  };

  if (!res.ok || !payload.secure_url) {
    throw new Error(payload.error?.message || `Cloudinary upload failed (${res.status})`);
  }

  return payload.secure_url;
}

/**
 * Validates raw file bytes via magic signature (prevents spoofed MIME types or HTML/SVG XSS).
 */
export function detectValidatedMimeAndExt(buffer: Buffer): { mimeType: string; ext: string } | null {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', ext: 'png' };
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }

  // PDF: %PDF-
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { mimeType: 'application/pdf', ext: 'pdf' };
  }

  return null;
}

export class UploadService {
  /**
   * Stores uploaded image/PDF in Cloudinary when configured (keeping a lightweight URL pointer
   * in PostgreSQL `UploadedFile` for RBAC & audit), with safe database-byte fallback offline.
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: UploadFolder = 'general',
    ownerId: string
  ): Promise<StoredUploadResult> {
    if (!ALLOWED_FOLDERS.has(folder)) {
      throw new Error('Invalid upload folder.');
    }
    if (!ownerId) {
      throw new Error('Authenticated ownerId is required for uploads.');
    }
    if (buffer.length === 0) {
      throw new Error('Uploaded file is empty.');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('File exceeds the maximum allowed size of 8 MB.');
    }

    const detected = detectValidatedMimeAndExt(buffer);
    if (!detected) {
      throw new Error('Unsupported or invalid file format. Only real JPG, PNG, WEBP, and PDF files are allowed.');
    }

    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const filename = `${folder}-${Date.now()}-${randomSuffix}.${detected.ext}`;

    let cloudinaryUrl: string | null = null;
    if (isCloudinaryConfigured() && buffer.byteLength > 64) {
      try {
        cloudinaryUrl = await uploadBufferToCloudinary(
          buffer,
          folder,
          detected.ext,
          detected.mimeType
        );
      } catch (err) {
        if (process.env.CLOUDINARY_STRICT === 'true') {
          throw err;
        }
        console.warn('Cloudinary upload failed, falling back to PostgreSQL storage:', err);
      }
    }

    const record = await prisma.uploadedFile.create({
      data: {
        ownerId,
        folder,
        filename,
        mimeType: detected.mimeType,
        size: buffer.length,
        data: cloudinaryUrl ? Buffer.from(cloudinaryUrl, 'utf8') : Buffer.from(buffer),
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
      },
    });

    return {
      id: record.id,
      url: cloudinaryUrl || `/api/uploads/${record.id}`,
      filename: record.filename,
      size: record.size,
      format: detected.ext,
      mimeType: record.mimeType,
      storage: cloudinaryUrl ? 'cloudinary' : 'database',
    };
  }

  async uploadDataUri(
    dataUri: string,
    folder: UploadFolder = 'general',
    ownerId: string
  ): Promise<StoredUploadResult> {
    const matches = dataUri.match(/^data:([A-Za-z0-9/+.-]+);base64,(.+)$/);
    const base64Payload = matches && matches.length === 3 ? matches[2] : dataUri;
    const buffer = Buffer.from(base64Payload, 'base64');
    return this.uploadBuffer(buffer, folder, ownerId);
  }
}

export const uploadService = new UploadService();
