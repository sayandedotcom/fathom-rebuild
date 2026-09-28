'use client';

import { useState } from 'react';
import { BotJoiner } from '@/components/bot-joiner';
import { Recorder } from '@/components/recorder';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Uploader } from '@/components/uploader';
import type { NewMeetingTab } from '@/lib/new-meeting-tabs';

// Controlled so a nav link to /new?tab=record switches tabs in place; re-keying
// would remount the Recorder and silently drop an in-progress recording.
export function NewMeetingTabs({ tab }: { tab: NewMeetingTab }) {
  const [value, setValue] = useState<string>(tab);
  const [prevTab, setPrevTab] = useState(tab);
  if (tab !== prevTab) {
    setPrevTab(tab);
    setValue(tab);
  }

  return (
    <Tabs value={value} onValueChange={(v) => setValue(String(v))}>
      <TabsList>
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="record">Record</TabsTrigger>
        <TabsTrigger value="bot">Join a meeting</TabsTrigger>
      </TabsList>
      <TabsContent value="upload" className="pt-4"><Uploader /></TabsContent>
      <TabsContent value="record" keepMounted className="pt-4"><Recorder /></TabsContent>
      <TabsContent value="bot" className="pt-4"><BotJoiner /></TabsContent>
    </Tabs>
  );
}
