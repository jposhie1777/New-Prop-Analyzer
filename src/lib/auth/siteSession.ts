export const sessionCookieName = "pulse_session";
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 365; // stay signed in on this device for a year

export async function sessionToken(sitePassword: string): Promise<string> {
  const encoded = new TextEncoder().encode(`pulse-nba-session:${sitePassword}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded); // the cookie holds a hash, never the password
  return [...new Uint8Array(digest)].map((byteValue) => byteValue.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let characterIndex = 0; characterIndex < first.length; characterIndex++) difference |= first.charCodeAt(characterIndex) ^ second.charCodeAt(characterIndex);
  return difference === 0;
}

export function safeNextPath(rawPath: string | null | undefined): string {
  if (!rawPath || !rawPath.startsWith("/") || rawPath.startsWith("//") || rawPath.startsWith("/login")) return "/"; // only same-site paths, never an open redirect
  return rawPath;
}
