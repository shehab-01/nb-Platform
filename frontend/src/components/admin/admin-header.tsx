"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { StoreDomainBadge } from "@/components/admin/store-domain-badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HEADER_LINKS, pageTitle, type HeaderLink } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

const ITEM_CLASS =
  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors";

function HeaderItem({
  link,
  active,
}: {
  link: HeaderLink;
  active: boolean;
}) {
  const content = (
    <>
      <link.icon className="size-4 shrink-0" />
      {link.title}
    </>
  );

  // Links without a destination are placeholders for screens not built yet.
  // They keep the menu's shape without pretending to go somewhere.
  if (!link.href) {
    return (
      <button
        type="button"
        aria-disabled
        title={`${link.title} — coming soon`}
        className={cn(ITEM_CLASS, "text-muted-foreground hover:bg-table-header")}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        ITEM_CLASS,
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-table-header hover:text-foreground"
      )}
    >
      {content}
    </Link>
  );
}

export function AdminHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
      <SidebarTrigger className="-ml-1" />
      <h1 className="shrink-0 text-sm font-semibold text-foreground">
        {pageTitle(pathname)}
      </h1>
      <div className="ml-auto flex items-center gap-3">
        <StoreDomainBadge />
        {/* Two different things sit on this side — where the store lives, and
            where to go next — so a short hairline keeps them from reading as
            one row of controls. A plain span: the Separator primitive
            stretches to the bar's full height when vertical. */}
        <span aria-hidden className="hidden h-4 w-px bg-border md:block" />
        {/* Phones get only the sidebar: the quick links would otherwise
            overflow the bar sideways. */}
        <nav className="hidden items-center gap-1 md:flex">
          {HEADER_LINKS.map((link) => (
            <HeaderItem
              key={link.title}
              link={link}
              active={link.href === pathname}
            />
          ))}
        </nav>
      </div>
    </header>
  );
}
