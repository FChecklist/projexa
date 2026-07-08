import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppTopbar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-px-ink2 bg-px-ink px-4 shadow-nav">
      <div className="lg:hidden">
        <AppSidebar />
      </div>
      <h1 className="font-heading text-base font-semibold text-white">{title}</h1>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  );
}
