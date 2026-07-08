export type TokenRequest = {
  identity: string;
  roomName: string;
};

export type TokenResponse = {
  token: string;
  wsUrl: string;
};

export type SessionConfig = {
  serverUrl: string;
  roomName: string;
  identity: string;
  e2eeKey?: string;
  transcriptionEnabled: boolean;
};

/**
 * Generic wrapper for every message the optional Python agent publishes on
 * a DataChannel topic (fixed contract, see docs/PLAN.md §7.2).
 *
 * `type` identifies the message kind (matches the DataChannel topic name),
 * `version` is reserved for backward compatibility when the `payload` shape
 * changes in the future. Consumers must check `type` before handling a
 * message and ignore unknown types (forward-compatible).
 */
export type AgentMessage<TType extends string, TPayload> = {
  type: TType;
  version: number;
  payload: TPayload;
};

/**
 * Payload for `type: "transcript_final"` — published once a call ends.
 * `summary` is always a string: `""` means no summary is available
 * (`ENABLE_SUMMARY=false` on the agent, or Ollama was unreachable — see
 * docs/PLAN.md HIGH RISK 4.3), never `undefined`.
 */
export type TranscriptFinalPayload = {
  transcript: string;
  summary: string;
};

/**
 * Payload for `type: "transcript_live"` — reserved for future real-time
 * captions, not published by the current agent (see docs/PLAN.md §7.2).
 */
export type TranscriptLivePayload = {
  text: string;
};

export type TranscriptFinalMessage = AgentMessage<"transcript_final", TranscriptFinalPayload>;
export type TranscriptLiveMessage = AgentMessage<"transcript_live", TranscriptLivePayload>;

/** Union of all known agent messages; unknown `type` values must be ignored. */
export type AnyAgentMessage = TranscriptFinalMessage | TranscriptLiveMessage;

