import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { SlipFab } from "@/components/SlipFab";
import { ThemeSync } from "@/components/ThemeSync";
import { CloudSync } from "@/components/CloudSync";
import { settingsStorageKey } from "@/lib/client/settings";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: "Pulse NBA",
  description: "Personal NBA betting analytics powered by BALLDONTLIE",
  robots: { index: false, follow: false }, // personal project, keep it out of search
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

const themeScript = `try{var appearance=(JSON.parse(localStorage.getItem(${JSON.stringify(settingsStorageKey)})||"{}").appearance)||"light";if(appearance==="dark"||(appearance==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(themeError){}`; // runs before paint so dark mode never flashes light

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeSync />
        <CloudSync />
        <div className="app-shell">
          <AppHeader />
          <div className="app-main">
            {children}
            <footer className="footer-note">Personal, non-commercial project. Data: BALLDONTLIE. Logos and headshots: NBA. Informational only, not betting advice.</footer>
          </div>
        </div>
        <SlipFab />
      </body>
    </html>
  );
}
