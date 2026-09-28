import { createBot, getBot, getMixedAudioUrl } from '../lib/bot/recall';

async function main() {
  const meetingUrl = process.argv[2];
  if (!meetingUrl) throw new Error('usage: npm run check:recall -- https://meet.google.com/abc-defg-hij');
  const id = await createBot(meetingUrl, 'check-recall');
  console.log(`bot ${id}: admit "Fanthom Notetaker" in Meet, talk for ~30s, then remove the bot or end the call`);
  let last = '';
  for (;;) {
    const bot = await getBot(id);
    const latest = bot.status_changes.at(-1);
    const line = `${latest?.code ?? 'none'} ${latest?.sub_code ?? ''} recordings=${bot.recordings.length}`;
    if (line !== last) console.log(new Date().toISOString(), (last = line));
    if (latest?.code === 'done' || latest?.code === 'fatal') break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  const bot = await getBot(id);
  console.log(JSON.stringify(bot.status_changes, null, 2));
  if (bot.recordings[0]) console.log('audio', await getMixedAudioUrl(bot.recordings[0].id));
  console.log('BOT_ID', id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
