import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useChat, useRoomContext } from "@livekit/components-react";
import { Paperclip, Send, X } from "lucide-react";

export type ChatPanelProps = {
  /** When false the panel is kept mounted but hidden, so chat history and
   *  incoming messages/files are never lost while it is closed. */
  isOpen?: boolean;
  onClose?: () => void;
};

/** Topic used for file transfers over LiveKit byte streams. */
const FILE_TOPIC = "files";

type FileAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size?: number;
  from: string;
  timestamp: number;
};

type ChatItem =
  | { kind: "text"; id: string; timestamp: number; from: string; message: string }
  | { kind: "file"; id: string; timestamp: number; from: string; attachment: FileAttachment };

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * In-conference text chat + file sharing built on LiveKit's DataChannel:
 * text via the `useChat` hook, files via byte streams (`sendFile` /
 * `registerByteStreamHandler`). Nothing is persisted to disk, the server,
 * or any storage — history lives only in component state for the duration
 * of the session (HIGH RISK: "never store user data or session history
 * server-side").
 */
export function ChatPanel({ isOpen = true, onClose }: ChatPanelProps) {
  const { chatMessages, send, isSending } = useChat();
  const room = useRoomContext();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track every object URL we create so we can revoke them all on unmount.
  const objectUrlsRef = useRef<string[]>([]);

  // Receive files sent by other participants. Registered once for the room's
  // lifetime (ChatPanel stays mounted); unregistered on unmount.
  useEffect(() => {
    if (!room) return;

    const handler = (
      reader: { info: { id: string; name: string; mimeType: string; size?: number; timestamp: number }; readAll: () => Promise<Uint8Array[]> },
      participant: { identity: string },
    ) => {
      void (async () => {
        const info = reader.info;
        const chunks = await reader.readAll();
        const blob = new Blob(chunks as BlobPart[], { type: info.mimeType });
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        setAttachments((prev) => [
          ...prev,
          {
            id: info.id,
            name: info.name,
            url,
            mimeType: info.mimeType,
            size: info.size,
            from: participant.identity,
            timestamp: info.timestamp || Date.now(),
          },
        ]);
      })();
    };

    try {
      room.registerByteStreamHandler(FILE_TOPIC, handler as never);
    } catch {
      // A handler for this topic is already registered (e.g. StrictMode
      // double-invoke before cleanup ran) — safe to ignore.
    }

    return () => {
      try {
        room.unregisterByteStreamHandler(FILE_TOPIC);
      } catch {
        // ignore — nothing registered
      }
    };
  }, [room]);

  // Revoke all object URLs when the panel unmounts.
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  const items = useMemo<ChatItem[]>(() => {
    const textItems: ChatItem[] = chatMessages.map((msg) => ({
      kind: "text",
      id: msg.id ?? String(msg.timestamp),
      timestamp: msg.timestamp,
      from: msg.from?.identity ?? "Unknown",
      message: msg.message,
    }));
    const fileItems: ChatItem[] = attachments.map((a) => ({
      kind: "file",
      id: a.id,
      timestamp: a.timestamp,
      from: a.from,
      attachment: a,
    }));
    return [...textItems, ...fileItems].sort((a, b) => a.timestamp - b.timestamp);
  }, [chatMessages, attachments]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;

    void send(message);
    setDraft("");
  }

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files;
    const files = selected ? Array.from(selected) : [];
    // Reset synchronously so picking the same file again re-fires onChange.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (files.length === 0 || !room) return;

    for (const file of files) {
      try {
        await room.localParticipant.sendFile(file, { topic: FILE_TOPIC });
        // Show the file in the sender's own chat too (the sender does not
        // receive its own byte stream back).
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.push(url);
        setAttachments((prev) => [
          ...prev,
          {
            id: `local-${file.name}-${file.size}-${Date.now()}`,
            name: file.name,
            url,
            mimeType: file.type,
            size: file.size,
            from: room.localParticipant.identity,
            timestamp: Date.now(),
          },
        ]);
      } catch (err) {
        console.error("Failed to send file", err);
      }
    }
  }

  return (
    <div className={`chat-panel${isOpen ? "" : " chat-panel--hidden"}`}>
      <div className="chat-panel__header">
        <span>Чат</span>
        {onClose && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close chat">
            <X size={18} />
          </button>
        )}
      </div>

      <ul className="chat-panel__messages">
        {items.map((item) => (
          <li key={item.id} className="chat-panel__message">
            <strong>{item.from}</strong>:{" "}
            {item.kind === "text" ? (
              item.message
            ) : (
              <a href={item.attachment.url} download={item.attachment.name} className="chat-panel__attachment">
                📎 {item.attachment.name}
                {item.attachment.size !== undefined && ` (${formatSize(item.attachment.size)})`}
              </a>
            )}
          </li>
        ))}
      </ul>

      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => void handleFilesSelected(e)}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
          title="Прикрепить файл"
        >
          <Paperclip size={18} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="Введите сообщение…"
          disabled={isSending}
        />
        <button
          type="submit"
          className="icon-button"
          disabled={isSending || !draft.trim()}
          aria-label="Send"
          title="Отправить"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
