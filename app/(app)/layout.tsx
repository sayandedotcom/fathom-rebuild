import Link from "next/link";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <Link href="/" className="font-semibold">Fanthom</Link>
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">Meetings</Link>
            <Link href="/new?tab=record" className="text-sm font-medium underline-offset-4 hover:underline">Record</Link>
            <Link href="/new?tab=bot" className="text-sm font-medium underline-offset-4 hover:underline">Join a meeting</Link>
            <Link href="/new?tab=upload" className="text-sm font-medium underline-offset-4 hover:underline">Upload</Link>
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
