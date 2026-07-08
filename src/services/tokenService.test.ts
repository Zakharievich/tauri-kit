import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestToken, TokenServiceError } from "./tokenService";

describe("requestToken", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the /token endpoint with correct method, headers and body", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ token: "abc.def.ghi", wsUrl: "wss://example.com" }),
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await requestToken("https://server.example.com/", {
      identity: "alice",
      roomName: "room-1",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("https://server.example.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "alice", roomName: "room-1" }),
    });
    expect(result).toEqual({ token: "abc.def.ghi", wsUrl: "wss://example.com" });
  });

  it("strips a trailing slash from serverUrl before appending /token", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ token: "t", wsUrl: "wss://example.com" }),
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await requestToken("https://server.example.com", { identity: "bob", roomName: "room-2" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://server.example.com/token",
      expect.anything(),
    );
  });

  it("throws TokenServiceError with the server-provided message on non-ok response", async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: "roomName is required" }),
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(requestToken("https://server.example.com", { identity: "a", roomName: "" })).rejects.toMatchObject(
      { message: "roomName is required", status: 400 },
    );
  });

  it("throws TokenServiceError on network failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    await expect(
      requestToken("https://server.example.com", { identity: "a", roomName: "room" }),
    ).rejects.toThrow(TokenServiceError);
  });

  it("throws TokenServiceError when the response body is missing token or wsUrl", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ token: "", wsUrl: "" }),
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(
      requestToken("https://server.example.com", { identity: "a", roomName: "room" }),
    ).rejects.toThrow(/Invalid token response/);
  });
});
