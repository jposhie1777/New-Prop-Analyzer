"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/client/hooks";

export function ThemeSync() {
  const { appearance } = useSettings();
  useEffect(() => {
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = appearance === "dark" || (appearance === "system" && darkQuery.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171a21" : "#ffffff");
    };
    applyTheme();
    darkQuery.addEventListener("change", applyTheme); // System follows the phone or computer as it changes
    return () => darkQuery.removeEventListener("change", applyTheme);
  }, [appearance]);
  return null;
}
