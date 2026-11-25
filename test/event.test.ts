import { describe, expect, it } from "vitest";
import {
  decryptLarkPayload,
  EventAuthError,
  EventFormatError,
  parseLarkEvent,
} from "../src/lark/event";

const encoder = new TextEncoder();

async function encryptForTest(obj: unknown, key: string): Promise<string> {
  const keyHash = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyHash,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const plain = encoder.encode(JSON.stringify(obj));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, plain),
  );
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);

  let binary = "";
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

async function signForTest(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(timestamp + nonce + encryptKey + rawBody),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("Lark event parsing and decryption", () => {
  it("decryptLarkPayload matches official Lark test vector", async () => {
    const plain = await decryptLarkPayload(
      "P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=",
      "test key",
    );
    expect(plain).toBe("hello world");
  });

  it("handles unencrypted url_verification with valid token and rejects invalid token", async () => {
    const raw = JSON.stringify({
      type: "url_verification",
      token: "verify_ok",
      challenge: "chal_123",
    });

    const parsed = await parseLarkEvent(raw, new Headers(), {
      encryptKey: "",
      verificationToken: "verify_ok",
    });
    expect(parsed).toEqual({ kind: "challenge", challenge: "chal_123" });

    await expect(
      parseLarkEvent(raw, new Headers(), {
        encryptKey: "",
        verificationToken: "verify_wrong",
      }),
    ).rejects.toThrow(EventAuthError);
  });

  it("handles encrypted url_verification", async () => {
    const encrypt = await encryptForTest(
      { type: "url_verification", token: "verify_ok", challenge: "chal_enc" },
      "my_secret_key",
    );
    const raw = JSON.stringify({ encrypt });

    const parsed = await parseLarkEvent(raw, new Headers(), {
      encryptKey: "my_secret_key",
      verificationToken: "verify_ok",
    });
    expect(parsed).toEqual({ kind: "challenge", challenge: "chal_enc" });
  });

  it("throws EventAuthError when body has encrypt but encryptKey is empty", async () => {
    const encrypt = await encryptForTest(
      { type: "url_verification", token: "verify_ok", challenge: "chal_enc" },
      "my_secret_key",
    );
    const raw = JSON.stringify({ encrypt });

    await expect(
      parseLarkEvent(raw, new Headers(), {
        encryptKey: "",
        verificationToken: "verify_ok",
      }),
    ).rejects.toThrow(EventAuthError);
  });

  it("parses v1 approval_instance event", async () => {
    const raw = JSON.stringify({
      type: "event_callback",
      token: "verify_ok",
      event: {
        type: "approval_instance",
        approval_code: "CODE_REMOTE",
        instance_code: "INST_1",
        status: "APPROVED",
      },
    });

    const parsed = await parseLarkEvent(raw, new Headers(), {
      encryptKey: "",
      verificationToken: "verify_ok",
    });
    expect(parsed).toEqual({
      kind: "approval_instance",
      approvalCode: "CODE_REMOTE",
      instanceCode: "INST_1",
      status: "APPROVED",
    });
  });

  it("parses v2 approval_instance event", async () => {
    const raw = JSON.stringify({
      schema: "2.0",
      header: {
        token: "verify_ok",
        event_type: "approval_instance",
      },
      event: {
        approval_code: "CODE_OFF",
        instance_code: "INST_2",
        status: "CANCELED",
      },
    });

    const parsed = await parseLarkEvent(raw, new Headers(), {
      encryptKey: "",
      verificationToken: "verify_ok",
    });
    expect(parsed).toEqual({
      kind: "approval_instance",
      approvalCode: "CODE_OFF",
      instanceCode: "INST_2",
      status: "CANCELED",
    });
  });

  it("returns kind other for unrelated event types", async () => {
    const raw = JSON.stringify({
      schema: "2.0",
      header: {
        token: "verify_ok",
        event_type: "im.message.receive_v1",
      },
      event: {},
    });

    const parsed = await parseLarkEvent(raw, new Headers(), {
      encryptKey: "",
      verificationToken: "verify_ok",
    });
    expect(parsed).toEqual({
      kind: "other",
      eventType: "im.message.receive_v1",
    });
  });

  it("verifies X-Lark-Signature when present and allows requests without signature header", async () => {
    const encryptKey = "sig_key";
    const encrypt = await encryptForTest(
      { type: "url_verification", token: "verify_ok", challenge: "chal_sig" },
      encryptKey,
    );
    const raw = JSON.stringify({ encrypt });
    const ts = "1700000000";
    const nonce = "nonce_abc";
    const sig = await signForTest(ts, nonce, encryptKey, raw);

    const validHeaders = new Headers({
      "X-Lark-Request-Timestamp": ts,
      "X-Lark-Request-Nonce": nonce,
      "X-Lark-Signature": sig.toUpperCase(),
    });
    const ok = await parseLarkEvent(raw, validHeaders, {
      encryptKey,
      verificationToken: "verify_ok",
    });
    expect(ok).toEqual({ kind: "challenge", challenge: "chal_sig" });

    const badHeaders = new Headers({
      "X-Lark-Request-Timestamp": ts,
      "X-Lark-Request-Nonce": nonce,
      "X-Lark-Signature": "deadbeef",
    });
    await expect(
      parseLarkEvent(raw, badHeaders, {
        encryptKey,
        verificationToken: "verify_ok",
      }),
    ).rejects.toThrow(EventAuthError);

    const noSigOk = await parseLarkEvent(raw, new Headers(), {
      encryptKey,
      verificationToken: "verify_ok",
    });
    expect(noSigOk).toEqual({ kind: "challenge", challenge: "chal_sig" });
  });

  it("throws EventFormatError on non-JSON body", async () => {
    await expect(
      parseLarkEvent("{not-json", new Headers(), {
        encryptKey: "",
        verificationToken: "verify_ok",
      }),
    ).rejects.toThrow(EventFormatError);
  });
});
