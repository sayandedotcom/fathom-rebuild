import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { meetings, utterances } from '../lib/db/schema';

async function main() {
  const [m] = await db
    .insert(meetings)
    .values({ title: 'db-check', audioUrl: 'https://example.com/a.mp3', assemblyaiId: `db-check-${Date.now()}` })
    .returning();
  await db.insert(utterances).values({ meetingId: m.id, speaker: 'A', startMs: 0, endMs: 1000, text: 'We decided to ship pricing on Friday' });
  const hits = await db.execute(
    sql`select text from utterances where meeting_id = ${m.id} and tsv @@ websearch_to_tsquery('english', 'pricing decide')`,
  );
  await db.delete(meetings).where(eq(meetings.id, m.id));
  console.log(hits.rows.length === 1 ? 'FTS OK' : `FTS FAILED: ${JSON.stringify(hits.rows)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
