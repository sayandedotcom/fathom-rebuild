import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
