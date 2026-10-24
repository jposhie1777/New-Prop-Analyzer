import { recordDeviceRequest } from "./deviceUsage";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchApi<ResponseType>(requestPath: string, init?: RequestInit): Promise<ResponseType> {
  const response = await fetch(requestPath, init);
  const bodyText = await response.text();
  const durationHeader = response.headers.get("x-pulse-duration-ms");
  recordDeviceRequest(requestPath, response.headers.get("x-vercel-cache"), bodyText.length, durationHeader ? Number(durationHeader) : null); // x-vercel-cache tells CDN hit vs function run
  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      errorMessage = (JSON.parse(bodyText) as { error?: string }).error ?? errorMessage;
    } catch {
      errorMessage = bodyText.slice(0, 200) || errorMessage;
    }
    throw new ApiError(errorMessage, response.status);
  }
  return JSON.parse(bodyText) as ResponseType;
}
