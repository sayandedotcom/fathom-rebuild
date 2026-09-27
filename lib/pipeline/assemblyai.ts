import { AssemblyAI } from 'assemblyai';
import { requireEnv } from '../env';

function client() {
  return new AssemblyAI({ apiKey: requireEnv('ASSEMBLYAI_API_KEY') });
}

function webhookUrl(): string | undefined {
  const appUrl = process.env.APP_URL;
  if (!appUrl?.startsWith('https://')) return undefined;
  return `${appUrl}/api/webhooks/assemblyai?secret=${encodeURIComponent(requireEnv('WEBHOOK_SECRET'))}`;
}

export async function submitTranscription(audioUrl: string): Promise<string> {
  const transcript = await client().transcripts.submit({
    audio: audioUrl,
    speech_models: ['universal-3-5-pro', 'universal-2'],
    language_detection: true,
    speaker_labels: true,
    webhook_url: webhookUrl(),
  });
  return transcript.id;
}

export async function getTranscription(id: string) {
  return client().transcripts.get(id);
}
