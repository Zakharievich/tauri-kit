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

/** A single utterance produced by the optional STT agent. */
export type TranscriptSegment = {
  participantId: string;
  participantName?: string;
  text: string;
  timestamp: number;
};

/**
 * Payload published by the optional Python agent on the `transcript_final`
 * DataChannel topic once a call ends. `summary` is present only when
 * `ENABLE_SUMMARY=true` on the agent (see docs/PLAN.md section 5).
 */
export type TranscriptFinalPayload = {
  segments: TranscriptSegment[];
  summary?: string;
};

