import { useEffect, useRef, useState } from "react";
import { RoomEvent } from "livekit-client";
import { useMaybeRoomContext } from "@livekit/components-react";
import { invoke } from "@tauri-apps/api/core";
import type { AnyAgentMessage } from "../types";

/** DataChannel topic the optional Python agent publishes the final transcript on (docs/PLAN.md §7.2). */
const TRANSCRIPT_FINAL_TYPE = "transcript_final";

/** Marker appended before the optional summary block inside the saved/displayed text. */
export const SUMMARY_MARKER = "=== САММАРИ ===";

export type UseTranscriptionState = {
  /** Formatted transcript text (with an optional summary section), or `null` until one arrives. */
  text: string | null;
};

function formatTranscriptText(transcript: string, summary: string): string {
  return summary ? `${transcript}\n\n${SUMMARY_MARKER}\n${summary}` : transcript;
}

/**
 * Subscribes to the `transcript_final` DataChannel topic published by the
 * optional Python STT agent (see docs/PLAN.md §7.2). Messages follow the
 * fixed `{ type, version, payload }` envelope — only `type ===
 * "transcript_final"` is handled here, any other/unknown `type` is
 * ignored (forward-compatible with future message kinds, e.g.
 * `transcript_live`). Once a payload arrives it is formatted into plain
 * text and persisted locally via the `save_transcript` Tauri command —
 * never sent to any server.
 *
 * If the agent is not running (disabled, crashed, or transcription turned
 * off), no `dataReceived` event with this topic will ever fire, so the hook
 * simply stays inert and returns `{ text: null }` — graceful degradation
 * (HIGH RISK 4.3).
 */
export function useTranscription(enabled = true): UseTranscriptionState {
  const room = useMaybeRoomContext();
  const [text, setText] = useState<string | null>(null);
  const decoderRef = useRef<TextDecoder>(new TextDecoder());

  useEffect(() => {
    if (!enabled || !room) {
      return;
    }

    function handleDataReceived(payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) {
      if (topic !== TRANSCRIPT_FINAL_TYPE) {
        return;
      }

      let message: AnyAgentMessage;
      try {
        message = JSON.parse(decoderRef.current.decode(payload)) as AnyAgentMessage;
      } catch {
        // Malformed payload from the agent — ignore and stay graceful.
        return;
      }

      // Forward-compatible: only handle known message types, ignore the rest.
      if (message.type !== TRANSCRIPT_FINAL_TYPE) {
        return;
      }

      const { transcript, summary } = message.payload;
      const formatted = formatTranscriptText(transcript, summary);
      setText(formatted);

      invoke("save_transcript", {
        transcriptContent: formatted,
        filename: `transcript-${Date.now()}.txt`,
      }).catch(() => {
        // Saving is best-effort; a failure here must not break the app
        // (graceful degradation, HIGH RISK 4.3).
      });
    }

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, enabled]);

  return { text };
}
