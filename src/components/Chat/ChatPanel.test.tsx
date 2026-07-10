import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendMock = vi.fn().mockResolvedValue(undefined);
let chatMessages: Array<{ id?: string; timestamp: number; from?: { identity: string }; message: string }> = [];

const roomMock = {
  localParticipant: { identity: "me", sendFile: vi.fn().mockResolvedValue({ id: "x" }) },
  registerByteStreamHandler: vi.fn(),
  unregisterByteStreamHandler: vi.fn(),
};

vi.mock("@livekit/components-react", () => ({
  useChat: () => ({
    chatMessages,
    send: sendMock,
    isSending: false,
  }),
  useRoomContext: () => roomMock,
}));

const downloadAttachmentMock = vi.fn().mockResolvedValue(true);
vi.mock("../../services/fileDownload", () => ({
  downloadAttachment: (name: string, url: string) => downloadAttachmentMock(name, url),
}));

import { ChatPanel } from "./ChatPanel";

/** Builds a File whose `.size` is forced to `size` bytes (jsdom would
 *  otherwise report 0 for an empty file). */
function fileOfSize(name: string, size: number, type = "application/octet-stream"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

describe("ChatPanel", () => {
  beforeEach(() => {
    sendMock.mockClear();
    roomMock.localParticipant.sendFile.mockClear();
    downloadAttachmentMock.mockClear();
    chatMessages = [];
    // jsdom does not implement object URLs.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  it("renders existing chat messages", () => {
    chatMessages = [
      { id: "1", timestamp: 1, from: { identity: "alice" }, message: "hi there" },
    ];

    render(<ChatPanel />);

    expect(screen.getByText("alice", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/hi there/)).toBeInTheDocument();
  });

  it("sends a message on submit and clears the input", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    const input = screen.getByPlaceholderText(/введите сообщение/i);
    await user.type(input, "hello world");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(sendMock).toHaveBeenCalledWith("hello world");
    expect(input).toHaveValue("");
  });

  it("does not send an empty/whitespace-only message", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    const input = screen.getByPlaceholderText(/введите сообщение/i);
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChatPanel onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /close chat/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uploads a small file, shows its card, and downloads it on click", async () => {
    const user = userEvent.setup();
    const { container } = render(<ChatPanel />);

    const file = fileOfSize("notes.txt", 1024, "text/plain");
    await user.upload(getFileInput(container), file);

    expect(roomMock.localParticipant.sendFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /download notes\.txt/i }));
    expect(downloadAttachmentMock).toHaveBeenCalledWith("notes.txt", "blob:mock");
  });

  it("rejects files larger than 50 MB and shows an error", async () => {
    const user = userEvent.setup();
    const { container } = render(<ChatPanel />);

    const big = fileOfSize("huge.bin", 51 * 1024 * 1024);
    await user.upload(getFileInput(container), big);

    expect(roomMock.localParticipant.sendFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/50 МБ/i);
  });
});
