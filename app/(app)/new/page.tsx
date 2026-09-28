import { NewMeetingTabs } from '@/components/new-meeting-tabs';
import { parseNewMeetingTab } from '@/lib/new-meeting-tabs';

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New meeting</h1>
      <NewMeetingTabs tab={parseNewMeetingTab(tab)} />
    </main>
  );
}
