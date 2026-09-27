import { Recorder } from '@/components/recorder';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Uploader } from '@/components/uploader';

export default function NewMeetingPage() {
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New meeting</h1>
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="record">Record</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="pt-4"><Uploader /></TabsContent>
        <TabsContent value="record" className="pt-4"><Recorder /></TabsContent>
      </Tabs>
    </main>
  );
}
