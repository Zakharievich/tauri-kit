import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useChat, useRoomContext } from "@livekit/components-react";
import { Download, Paperclip, Send, X } from "lucide-react";
import { downloadAttachment } from "../../services/fileDownload";

export type ChatPanelProps = {
  /** When false the panel is kept mounted but hidden, so chat history and
   *  incoming messages/files are never lost while it is closed. */
  isOpen?: boolean;
  onClose?: () => void;
};

/** Topic used for file transfers over LiveKit byte streams. */
const FILE_TOPIC = "files";

/** Hard cap on outgoing attachments (25 MB). Larger files are rejected before
 *  they ever hit the DataChannel. Files travel over the WebRTC data channel,
 *  whose throughput is limited, so the cap is kept modest. */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Human-readable form of MAX_FILE_SIZE for UI copy. */
const MAX_FILE_SIZE_LABEL = "25 МБ";

type FileAttachment = {
  id: string;
  name: string;
  /** The file bytes themselves — used to save the file on demand. Kept in
   *  memory for the session (no object URL / no disk copy). */
  blob: Blob;
  mimeType: string;
  size?: number;
  from: string;
  timestamp: number;
  /** Upload progress 0..1 while this (locally-sent) file is still transferring;
   *  undefined once the transfer has completed (or for received files). */
  progress?: number;
};

/** A file currently being received from another participant (shown as a
 *  "loading" row until all its bytes have arrived). */
type IncomingFile = {
  id: string;
  name: string;
  from: string;
  timestamp: number;
};

type ChatItem =
  | { kind: "text"; id: string; timestamp: number; from: string; message: string }
  | { kind: "file"; id: string; timestamp: number; from: string; attachment: FileAttachment }
  | { kind: "incoming"; id: string; timestamp: number; from: string; incoming: IncomingFile };

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * In-conference text chat + file sharing built on LiveKit's DataChannel:
 * text via the `useChat` hook, files via byte streams (`sendFile` /
 * `registerByteStreamHandler`). Nothing is persisted to disk, the server,
 * or any storage — history lives only in component state for the duration
 * of the session (HIGH RISK: "never store user data or session history
 * server-side"). Files can be saved to disk on demand via a native dialog.
 */
export function ChatPanel({ isOpen = true, onClose }: ChatPanelProps) {
  const { chatMessages, send, isSending } = useChat();
  const room = useRoomContext();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [incoming, setIncoming] = useState<IncomingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLUListElement>(null);

  const localIdentity = room?.localParticipant?.identity;

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
        const timestamp = info.timestamp || Date.now();
        // Show a "receiving…" row immediately so a slow transfer isn't invisible.
        setIncoming((prev) => [
          ...prev,
          { id: info.id, name: info.name, from: participant.identity, timestamp },
        ]);
        try {
          const chunks = await reader.readAll();
          const blob = new Blob(chunks as BlobPart[], { type: info.mimeType });
          setAttachments((prev) => [
            ...prev,
            {
              id: info.id,
              name: info.name,
              blob,
              mimeType: info.mimeType,
              size: info.size,
              from: participant.identity,
              timestamp,
            },
          ]);
        } catch {
          setError("Не удалось получить файл (повреждён или прерван).");
        } finally {
          setIncoming((prev) => prev.filter((f) => f.id !== info.id));
        }
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
    const incomingItems: ChatItem[] = incoming.map((f) => ({
      kind: "incoming",
      id: `incoming-${f.id}`,
      timestamp: f.timestamp,
      from: f.from,
      incoming: f,
    }));
    return [...textItems, ...fileItems, ...incomingItems].sort((a, b) => a.timestamp - b.timestamp);
  }, [chatMessages, attachments, incoming]);

  // Keep the newest message in view. `scrollTop` is a safe no-op in jsdom.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

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
      if (file.size > MAX_FILE_SIZE) {
        setError(`Файл «${file.name}» больше ${MAX_FILE_SIZE_LABEL} и не может быть отправлен.`);
        continue;
      }

      // Show the file in the sender's own chat immediately (the sender does not
      // receive its own byte stream back), starting at 0% so the transfer is
      // visible while it runs. The Blob is the File itself.
      const id = `local-${file.name}-${file.size}-${Date.now()}`;
      setAttachments((prev) => [
        ...prev,
        {
          id,
          name: file.name,
          blob: file,
          mimeType: file.type,
          size: file.size,
          from: room.localParticipant.identity,
          timestamp: Date.now(),
          progress: 0,
        },
      ]);

      try {
        await room.localParticipant.sendFile(file, {
          topic: FILE_TOPIC,
          onProgress: (progress) => {
            setAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, progress } : a)),
            );
          },
        });
        // Mark complete (drop the progress field).
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, progress: undefined } : a)),
        );
      } catch (err) {
        console.error("Failed to send file", err);
        setError(`Не удалось отправить файл «${file.name}».`);
        // Remove the failed upload from the list.
        setAttachments((prev) => prev.filter((a) => a.id !== id));
      }
    }
  }

  async function handleDownload(attachment: FileAttachment) {
    try {
      await downloadAttachment(attachment.name, attachment.blob);
    } catch (err) {
      console.error("Failed to download file", err);
      setError(`Не удалось сохранить файл «${attachment.name}».`);
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

      <ul className="chat-panel__messages" ref={messagesRef}>
        {items.map((item) => {
          const isSelf = localIdentity !== undefined && item.from === localIdentity;
          return (
            <li
              key={item.id}
              className={`chat-panel__message${isSelf ? " chat-panel__message--self" : ""}`}
            >
              <div className="chat-panel__bubble">
                {!isSelf && <span className="chat-panel__author">{item.from}</span>}
                {item.kind === "text" && (
                  <span className="chat-panel__text">{item.message}</span>
                )}
                {item.kind === "incoming" && (
                  <div className="chat-panel__attachment chat-panel__attachment--pending">
                    <span className="chat-panel__file-icon" aria-hidden>
                      📎
                    </span>
                    <span className="chat-panel__file-meta">
                      <span className="chat-panel__file-name" title={item.incoming.name}>
                        {item.incoming.name}
                      </span>
                      <span className="chat-panel__file-sub">Загрузка…</span>
                    </span>
                  </div>
                )}
                {item.kind === "file" && (
                  <div className="chat-panel__attachment">
                    <span className="chat-panel__file-icon" aria-hidden>
                      📎
                    </span>
                    <span className="chat-panel__file-meta">
                      <span className="chat-panel__file-name" title={item.attachment.name}>
                        {item.attachment.name}
                      </span>
                      <span className="chat-panel__file-sub">
                        {item.attachment.progress !== undefined
                          ? `Отправка… ${Math.round(item.attachment.progress * 100)}%`
                          : `${formatSize(item.attachment.size)}${
                              item.attachment.mimeType ? ` · ${item.attachment.mimeType}` : ""
                            }`}
                      </span>
                    </span>
                    {item.attachment.progress === undefined && (
                      <button
                        type="button"
                        className="icon-button chat-panel__download"
                        onClick={() => void handleDownload(item.attachment)}
                        aria-label={`Download ${item.attachment.name}`}
                        title="Скачать файл"
                      >
                        <Download size={16} />
                      </button>
                    )}
                  </div>
                )}
                <span className="chat-panel__time">{formatTime(item.timestamp)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="chat-panel__error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            title="Скрыть"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="chat-panel__hint">Файлы до {MAX_FILE_SIZE_LABEL}</div>

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
          title={`Прикрепить файл (до ${MAX_FILE_SIZE_LABEL})`}
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
