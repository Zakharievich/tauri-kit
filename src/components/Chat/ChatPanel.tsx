import { useState } from "react";
import type { FormEvent } from "react";
import { useChat } from "@livekit/components-react";

export type ChatPanelProps = {
  onClose?: () => void;
};

/**
 * In-conference text chat built on top of LiveKit's DataChannel (via the
 * `useChat` hook). Message history lives only in component/room state for
 * the duration of the session — nothing is persisted to disk, the server,
 * or any storage, and it is gone as soon as the session ends (HIGH RISK:
 * "never store user data or session history server-side").
 */
export function ChatPanel({ onClose }: ChatPanelProps) {
  const { chatMessages, send, isSending } = useChat();
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;

    void send(message);
    setDraft("");
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span>Chat</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close chat">
            ×
          </button>
        )}
      </div>

      <ul className="chat-panel__messages">
        {chatMessages.map((msg) => (
          <li key={msg.id ?? msg.timestamp} className="chat-panel__message">
            <strong>{msg.from?.identity ?? "Unknown"}</strong>: {msg.message}
          </li>
        ))}
      </ul>

      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="Type a message…"
          disabled={isSending}
        />
        <button type="submit" disabled={isSending || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
