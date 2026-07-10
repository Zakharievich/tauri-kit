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

import { ChatPanel } from "./ChatPanel";

describe("ChatPanel", () => {
  beforeEach(() => {
    sendMock.mockClear();
    chatMessages = [];
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
});
