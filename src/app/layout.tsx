import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "Pulse NBA",
  description: "Personal NBA betting analytics powered by BALLDONTLIE",
  robots: { index: false, follow: false }, // personal project, keep it out of search
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0e15" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppHeader />
        {children}
        <footer className="footer-note">Personal, non-commercial project. Data: BALLDONTLIE. Logos and headshots: NBA. Informational only, not betting advice.</footer>
      </body>
    </html>
  );
}
