import type { Metadata } from "next";
import type { ReactNode } from "react";
import { THEME_BOOT_SCRIPT } from "../src/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pinata",
  description: "pin + annotation + at ya — directional feedback on public websites",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the <head> script may set data-theme before
    // React hydrates, and the DOM's value is the one to keep (D104).
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
