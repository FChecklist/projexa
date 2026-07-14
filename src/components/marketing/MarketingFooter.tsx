import Image from "next/image";
import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="bg-px-ink py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Image src="/logo-mark.svg" alt="PROJEXA" width={22} height={22} />
          <span className="font-heading text-sm font-semibold text-white">PROJEXA</span>
          <span className="text-sm text-px-cloud2/60">— Construction Intelligence AI OS</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-px-cloud2">
          <Link href="/login" className="hover:text-white">Log in</Link>
          <Link href="/signup" className="hover:text-white">Sign up</Link>
        </div>
        <p className="text-xs text-px-cloud2/50">© {new Date().getFullYear()} PROJEXA. Built on VERIDIAN AI OS.</p>
      </div>
    </footer>
  );
}
