import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { documentDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { SUMMARY_MARKER } from "../hooks/useTranscription";

type TranscriptLocationState = {
  text?: string | null;
};

/**
 * Splits a transcript text into its main body and an optional summary
 * block, separated by the `SUMMARY_MARKER` line produced by
 * `useTranscription`.
 */
function splitTranscript(text: string): { body: string; summary: string | null } {
  const markerIndex = text.indexOf(SUMMARY_MARKER);
  if (markerIndex === -1) {
    return { body: text, summary: null };
  }

  const body = text.slice(0, markerIndex).trim();
  const summary = text.slice(markerIndex + SUMMARY_MARKER.length).trim();
  return { body, summary };
}

/**
 * Displays the transcript received from the optional agent (see
 * `useTranscription`). Shows an empty state if no transcript was ever
 * produced (agent absent, disabled, or E2EE was on — graceful degradation,
 * HIGH RISK 4.3). Never contacts a server; "Открыть в проводнике" only
 * reveals the local Documents folder where `save_transcript` writes files.
 */
export function TranscriptPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as TranscriptLocationState | null) ?? null;
  const text = state?.text ?? null;
  const [openError, setOpenError] = useState<string | null>(null);

  const parsed = useMemo(() => (text ? splitTranscript(text) : null), [text]);

  async function handleOpenInExplorer() {
    setOpenError(null);
    try {
      const dir = await documentDir();
      await openPath(dir);
    } catch {
      setOpenError("Не удалось открыть папку Documents");
    }
  }

  return (
    <main className="transcript-page">
      <h1>Транскрипт</h1>

      {!parsed && <p>Транскрипт недоступен для этой сессии.</p>}

      {parsed && (
        <>
          <section className="transcript-page__body">
            <pre>{parsed.body}</pre>
          </section>

          {parsed.summary && (
            <section className="transcript-page__summary">
              <h2>{SUMMARY_MARKER}</h2>
              <pre>{parsed.summary}</pre>
            </section>
          )}
        </>
      )}

      <div className="transcript-page__actions">
        <button onClick={() => void handleOpenInExplorer()}>Открыть в проводнике</button>
        <button onClick={() => navigate("/")}>На главную</button>
      </div>

      {openError && <p className="transcript-page__error">{openError}</p>}
    </main>
  );
}
