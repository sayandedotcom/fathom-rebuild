import Link from "next/link";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <Link href="/" className="font-semibold">Fanthom</Link>
          <div className="flex items-center gap-6">
            <Link href="/new?tab=record" className="text-sm font-medium underline-offset-4 hover:underline">Record</Link>
            <Link href="/new" className="text-sm font-medium underline-offset-4 hover:underline">New meeting</Link>
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
