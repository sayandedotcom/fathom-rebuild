import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { MAX_UPLOAD_BYTES } from '@/lib/limits';

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['audio/*', 'video/*'],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload rejected' }, { status: 400 });
  }
}
