import { invoke } from "@tauri-apps/api/core";

/**
 * Typed wrappers around every Tauri IPC command exposed by the Rust backend
 * (`src-tauri/src/commands.rs`). Per `.clinerules` ("All Tauri commands
 * typed"), no call site should invoke `@tauri-apps/api/core#invoke` with a
 * raw string — go through this module instead so argument/return shapes are
 * checked at compile time and the command name lives in a single place.
 */

export type SaveTranscriptArgs = {
  /** Formatted transcript text (with an optional summary section) to write to disk. */
  transcriptContent: string;
  /** File name to save the transcript as, inside the user's Documents directory. */
  filename: string;
};

/**
 * Saves the transcript to a `.txt` file in the current user's Documents
 * directory via the `save_transcript` Rust command. Resolves with the
 * absolute path of the written file.
 *
 * Never touches the network — the transcript stays local to the
 * participant's machine (docs/PLAN.md, HIGH RISK 4.3).
 */
export function saveTranscript(args: SaveTranscriptArgs): Promise<string> {
  return invoke<string>("save_transcript", args);
}
