"use client";

// Hub navigation. The current route is identified both by aria-current and by
// an aria-label so the active page is announced, not just colored.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { REQUIREMENTS_NAV } from "../lib/requirements";

export function ReqsNav() {
  const pathname = usePathname();
  return (
    <nav className="reqs-nav" aria-label="Requirements">
      <ul>
        {REQUIREMENTS_NAV.map(({ route, title }) => {
          const current = pathname === route;
          return (
            <li key={route}>
              <Link href={route} aria-current={current ? "page" : undefined}>
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
