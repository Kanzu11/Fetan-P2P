import { readFile } from 'fs/promises';
import path from 'path';

export async function GET() {
  const htmlPath = path.join(process.cwd(), 'telegram', 'dist', 'index.html');
  const html = await readFile(htmlPath, 'utf8');

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
