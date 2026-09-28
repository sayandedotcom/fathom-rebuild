import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';

const CUT_TIMEOUT_MS = 120_000;

// -ss before -i seeks the input, so ffmpeg fetches only the ranges it needs over HTTP instead of the whole recording.
export function ffmpegCutArgs(sourceUrl: string, startMs: number, endMs: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-ss', (startMs / 1000).toFixed(3), '-i', sourceUrl,
    '-t', ((endMs - startMs) / 1000).toFixed(3),
    '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1',
  ];
}

// ffmpeg-static's static binary crashes in glibc NSS when it resolves hostnames on some hosts, so it's only
// ever given a literal-IP URL: this proxy fetches the real (named) source itself and hands ffmpeg a loopback URL.
async function proxySource(sourceUrl: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url !== '/source' || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404).end();
    return;
  }
  const range = req.headers.range;
  try {
    const upstream = await fetch(sourceUrl, { method: req.method, headers: range ? { range } : {} });
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as never).pipe(res);
  } catch {
    res.writeHead(502).end();
  }
}

function startSourceProxy(sourceUrl: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void proxySource(sourceUrl, req, res);
    });
    const close = () => {
      server.closeAllConnections?.();
      server.close();
    };
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        close();
        reject(new Error('source proxy failed to bind'));
        return;
      }
      resolve({ port: address.port, close });
    });
  });
}

export async function cutAudio(sourceUrl: string, startMs: number, endMs: number): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg is not available on this platform');
  const ffmpeg: string = ffmpegPath;
  const proxy = await startSourceProxy(sourceUrl);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(ffmpeg, ffmpegCutArgs(`http://127.0.0.1:${proxy.port}/source`, startMs, endMs), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      let stderr = '';
      const timer = setTimeout(() => proc.kill('SIGKILL'), CUT_TIMEOUT_MS);
      proc.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-500);
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code, signal) => {
        clearTimeout(timer);
        const audio = Buffer.concat(out);
        if (code === 0 && audio.length > 0) return resolve(audio);
        reject(new Error(signal ? 'ffmpeg timed out' : `ffmpeg failed (${code}): ${stderr.trim() || 'no output'}`));
      });
    });
  } finally {
    proxy.close();
  }
}
