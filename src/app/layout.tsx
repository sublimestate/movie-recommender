import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Movie Recommender",
  description: "Discover movies and build your watchlist",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} font-sans antialiased bg-black text-white min-h-screen`}
      >
        <div className="max-w-4xl mx-auto px-4">
          <Navbar />
          <main className="py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
