import Link from "next/link";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <Link href="/" className="font-semibold">Fanthom</Link>
          <Link href="/new" className="text-sm font-medium underline-offset-4 hover:underline">New meeting</Link>
        </nav>
      </header>
      {children}
    </>
  );
}
