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
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB max per upload

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
   * Stores uploaded image/PDF safely inside PostgreSQL `UploadedFile` (private & durable across redeploys)
   * and returns an access-controlled `/api/uploads/<id>` URL.
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: UploadFolder = 'general',
    ownerId: string
  ): Promise<StoredUploadResult> {
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

    const record = await prisma.uploadedFile.create({
      data: {
        ownerId,
        folder,
        filename,
        mimeType: detected.mimeType,
        size: buffer.length,
        data: Buffer.from(buffer),
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
      url: `/api/uploads/${record.id}`,
      filename: record.filename,
      size: record.size,
      format: detected.ext,
      mimeType: record.mimeType,
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
