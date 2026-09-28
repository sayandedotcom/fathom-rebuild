import type { Metadata } from "next";
import { Figtree, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fanthom",
  description: "AI meeting notes: transcript, summary, action items and Q&A",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b">
          <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
            <Link href="/" className="font-semibold">Fanthom</Link>
            <Link href="/new" className="text-sm font-medium underline-offset-4 hover:underline">New meeting</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
