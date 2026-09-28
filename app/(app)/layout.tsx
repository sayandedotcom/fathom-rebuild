import Link from "next/link";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 p-4">
          <Link href="/" className="font-semibold">Fanthom</Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-6">
            <Link href="/" className="whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline">Meetings</Link>
            <Link href="/new?tab=record" className="whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline">Record</Link>
            <Link href="/new?tab=bot" className="whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline">Join a meeting</Link>
            <Link href="/new?tab=upload" className="whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline">Upload</Link>
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
