import { useEffect, useRef, useState } from "react";
import { RoomEvent } from "livekit-client";
import { useMaybeRoomContext } from "@livekit/components-react";
import { invoke } from "@tauri-apps/api/core";
import type { TranscriptFinalPayload, TranscriptSegment } from "../types";

/** DataChannel topic the optional Python agent publishes the final transcript on (docs/PLAN.md §7.2). */
const TRANSCRIPT_TOPIC = "transcript_final";

/** Marker appended before the optional summary block inside the saved/displayed text. */
export const SUMMARY_MARKER = "=== САММАРИ ===";

export type UseTranscriptionState = {
  /** Formatted transcript text (with an optional summary section), or `null` until one arrives. */
  text: string | null;
};

function formatTranscriptText(payload: TranscriptFinalPayload): string {
  const lines = payload.segments.map(
    (segment: TranscriptSegment) => `[${segment.participantName ?? segment.participantId}] ${segment.text}`,
  );
  const body = lines.join("\n");
  return payload.summary ? `${body}\n\n${SUMMARY_MARKER}\n${payload.summary}` : body;
}

/**
 * Subscribes to the `transcript_final` DataChannel topic published by the
 * optional Python STT agent (see docs/PLAN.md §7.2). Once a payload arrives
 * it is formatted into plain text and persisted locally via the
 * `save_transcript` Tauri command — never sent to any server.
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
      if (topic !== TRANSCRIPT_TOPIC) {
        return;
      }

      let parsed: TranscriptFinalPayload;
      try {
        parsed = JSON.parse(decoderRef.current.decode(payload)) as TranscriptFinalPayload;
      } catch {
        // Malformed payload from the agent — ignore and stay graceful.
        return;
      }

      const formatted = formatTranscriptText(parsed);
      setText(formatted);

      invoke("save_transcript", {
        content: formatted,
        fileName: `transcript-${Date.now()}.txt`,
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
