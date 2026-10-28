"use client";

import { useEffect } from "react";
import { startCloudSync } from "@/lib/client/cloudSync";

export function CloudSync() {
  useEffect(() => startCloudSync(), []);
  return null;
}
