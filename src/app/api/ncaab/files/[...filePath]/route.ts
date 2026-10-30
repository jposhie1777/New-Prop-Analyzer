import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { ncaabTier } from "@/lib/ncaab/ncaabTier";

export const dynamic = "force-dynamic";

const localRoot = process.env.NCAAB_LOCAL_DIR ?? ".ncaab-local"; // holds data/ and odds/ from running the NCAAB scripts locally

export async function GET(_request: NextRequest, context: { params: Promise<{ filePath: string[] }> }) {
  if (ncaabTier() !== "mock" && process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 }); // production reads the data branches instead
  const { filePath } = await context.params;
  const relative = normalize(filePath.join("/"));
  if (relative.startsWith("..") || !/^(data|odds)\//.test(relative) || !relative.endsWith(".json")) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    return new NextResponse(await readFile(join(process.cwd(), localRoot, relative), "utf8"), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
