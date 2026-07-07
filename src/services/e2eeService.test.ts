import { describe, it, expect, vi } from "vitest";
import { generateE2EEKey } from "./e2eeService";

describe("generateE2EEKey", () => {
  it("returns a 64-character lowercase hex string (32 random bytes)", () => {
    const key = generateE2EEKey();

    expect(typeof key).toBe("string");
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different key on every call", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateE2EEKey()));

    expect(keys.size).toBe(20);
  });

  it("derives the key from crypto.getRandomValues (not Math.random)", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");

    generateE2EEKey();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(32);

    spy.mockRestore();
  });
});
