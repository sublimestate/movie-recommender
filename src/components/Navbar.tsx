"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBar from "./SearchBar";

export default function Navbar() {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `px-4 py-2 rounded-lg font-medium transition-colors ${
      pathname === href
        ? "bg-white text-black"
        : "text-gray-300 hover:text-white hover:bg-white/10"
    }`;

  return (
    <nav className="flex items-center justify-center gap-2 py-4">
      <Link href="/" className={linkClass("/")}>
        Discover
      </Link>
      <Link href="/watchlist" className={linkClass("/watchlist")}>
        Watchlist
      </Link>
      <Link href="/watched" className={linkClass("/watched")}>
        Watched
      </Link>
      <Link href="/likely-watched" className={linkClass("/likely-watched")}>
        Likely Watched
      </Link>
      <Link href="/liked" className={linkClass("/liked")}>
        Liked
      </Link>
      <SearchBar />
    </nav>
  );
}
