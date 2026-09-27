import { Uploader } from '@/components/uploader';

export default function NewMeetingPage() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New meeting</h1>
      <Uploader />
    </main>
  );
}
