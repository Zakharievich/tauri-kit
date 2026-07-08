import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { RoomEvent } from "livekit-client";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let mockRoom: {
  handlers: Map<string, (...args: unknown[]) => void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
} | null = null;

vi.mock("@livekit/components-react", () => ({
  useMaybeRoomContext: () => mockRoom,
}));

function createMockRoom() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
  };
}

// Import after mocks are set up.
import { useTranscription, SUMMARY_MARKER } from "./useTranscription";

describe("useTranscription", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    mockRoom = null;
  });

  it("graceful degradation: stays inert (text stays null) when there is no room/agent", () => {
    mockRoom = null;

    const { result } = renderHook(() => useTranscription(true));

    expect(result.current.text).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("ignores DataChannel messages on topics other than transcript_final", () => {
    mockRoom = createMockRoom();
    const { result } = renderHook(() => useTranscription(true));

    const handler = mockRoom.handlers.get(RoomEvent.DataReceived);
    expect(handler).toBeDefined();

    const payload = new TextEncoder().encode(
      JSON.stringify({ type: "transcript_live", version: 1, payload: { text: "hi" } }),
    );

    act(() => {
      handler?.(payload, undefined, undefined, "some_other_topic");
    });

    expect(result.current.text).toBeNull();
  });

  it("parses a transcript_final message, formats text (with summary) and persists it", async () => {
    mockRoom = createMockRoom();
    const { result } = renderHook(() => useTranscription(true));

    const handler = mockRoom.handlers.get(RoomEvent.DataReceived);
    const message = {
      type: "transcript_final",
      version: 1,
      payload: { transcript: "hello world", summary: "short summary" },
    };
    const payload = new TextEncoder().encode(JSON.stringify(message));

    act(() => {
      handler?.(payload, undefined, undefined, "transcript_final");
    });

    await waitFor(() => {
      expect(result.current.text).toBe(`hello world\n\n${SUMMARY_MARKER}\nshort summary`);
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "save_transcript",
      expect.objectContaining({ transcriptContent: `hello world\n\n${SUMMARY_MARKER}\nshort summary` }),
    );
  });

  it("formats transcript without a summary section when summary is empty", async () => {
    mockRoom = createMockRoom();
    const { result } = renderHook(() => useTranscription(true));

    const handler = mockRoom.handlers.get(RoomEvent.DataReceived);
    const message = {
      type: "transcript_final",
      version: 1,
      payload: { transcript: "no summary here", summary: "" },
    };
    const payload = new TextEncoder().encode(JSON.stringify(message));

    act(() => {
      handler?.(payload, undefined, undefined, "transcript_final");
    });

    await waitFor(() => {
      expect(result.current.text).toBe("no summary here");
    });
  });

  it("ignores malformed JSON payloads without throwing", () => {
    mockRoom = createMockRoom();
    const { result } = renderHook(() => useTranscription(true));

    const handler = mockRoom.handlers.get(RoomEvent.DataReceived);
    const payload = new TextEncoder().encode("not-json{{{");

    expect(() => {
      act(() => {
        handler?.(payload, undefined, undefined, "transcript_final");
      });
    }).not.toThrow();

    expect(result.current.text).toBeNull();
  });

  it("does not subscribe at all when disabled", () => {
    mockRoom = createMockRoom();
    renderHook(() => useTranscription(false));

    expect(mockRoom.handlers.has(RoomEvent.DataReceived)).toBe(false);
  });
});
