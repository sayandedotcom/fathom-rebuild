export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-6">
      <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr_380px]">
        {[0, 1, 2].map((i) => <div key={i} className="h-96 animate-pulse rounded bg-muted" />)}
      </div>
    </main>
  );
}
