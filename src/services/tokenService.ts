import type { TokenRequest, TokenResponse } from "../types";

export class TokenServiceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TokenServiceError";
    this.status = status;
  }
}

/**
 * Requests a one-time LiveKit access token from the token server.
 * The token is never logged or cached (HIGH RISK 4.1).
 */
export async function requestToken(
  serverUrl: string,
  params: TokenRequest,
): Promise<TokenResponse> {
  let response: Response;

  try {
    response = await fetch(`${serverUrl.replace(/\/$/, "")}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new TokenServiceError("Network error while requesting token");
  }

  if (!response.ok) {
    let message = `Failed to request token (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // ignore body parse errors, keep default message
    }
    throw new TokenServiceError(message, response.status);
  }

  const data = (await response.json()) as TokenResponse;

  if (!data.token || !data.wsUrl) {
    throw new TokenServiceError("Invalid token response from server");
  }

  return data;
}
