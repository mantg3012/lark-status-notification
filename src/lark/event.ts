export class EventAuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "EventAuthError";
  }
}

export class EventFormatError extends Error {
  constructor(message = "Bad request") {
    super(message);
    this.name = "EventFormatError";
  }
}

export type ParsedEvent =
  | { kind: "challenge"; challenge: string }
  | { kind: "approval_instance"; approvalCode: string; instanceCode: string; status: string }
  | { kind: "other"; eventType: string };

export interface EventSecrets {
  encryptKey: string;
  verificationToken: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function decryptLarkPayload(encrypt: string, encryptKey: string): Promise<string> {
  try {
    const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptKey));
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyMaterial,
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );

    const raw = decodeBase64(encrypt);
    if (raw.byteLength <= 16) {
      throw new EventFormatError("Encrypted payload too short");
    }

    const iv = raw.subarray(0, 16);
    const cipher = raw.subarray(16);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, cipher);
    return decoder.decode(plainBuffer);
  } catch (err) {
    if (err instanceof EventFormatError) {
      throw err;
    }
    throw new EventFormatError("Failed to decrypt payload");
  }
}

export async function verifySignature(
  headers: Headers,
  rawBody: string,
  encryptKey: string,
): Promise<boolean> {
  // TODO verify whether Lark sends X-Lark-Signature
  const signature = headers.get("X-Lark-Signature");
  if (signature === null) {
    return true;
  }

  const timestamp = headers.get("X-Lark-Request-Timestamp");
  const nonce = headers.get("X-Lark-Request-Nonce");
  if (timestamp === null || nonce === null) {
    return false;
  }

  const payload = encoder.encode(timestamp + nonce + encryptKey + rawBody);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return toHex(digest) === signature.toLowerCase();
}

export async function parseLarkEvent(
  rawBody: string,
  headers: Headers,
  secrets: EventSecrets,
): Promise<ParsedEvent> {
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!isPlainObject(parsed)) {
      throw new EventFormatError("Event body must be a JSON object");
    }
    obj = parsed;
  } catch (err) {
    if (err instanceof EventFormatError) {
      throw err;
    }
    throw new EventFormatError("Invalid JSON body");
  }

  if (secrets.encryptKey !== "") {
    const valid = await verifySignature(headers, rawBody, secrets.encryptKey);
    if (!valid) {
      throw new EventAuthError("bad signature");
    }
  }

  if (typeof obj.encrypt === "string") {
    if (secrets.encryptKey === "") {
      throw new EventAuthError("encryptKey not configured");
    }
    const decrypted = await decryptLarkPayload(obj.encrypt, secrets.encryptKey);
    try {
      const parsed: unknown = JSON.parse(decrypted);
      if (!isPlainObject(parsed)) {
        throw new EventFormatError("Decrypted payload must be a JSON object");
      }
      obj = parsed;
    } catch (err) {
      if (err instanceof EventFormatError) {
        throw err;
      }
      throw new EventFormatError("Invalid JSON in decrypted payload");
    }
  }

  const header = isPlainObject(obj.header) ? obj.header : undefined;
  const token = header?.token ?? obj.token;
  if (typeof token !== "string" || token !== secrets.verificationToken) {
    throw new EventAuthError("bad token");
  }

  if (obj.type === "url_verification" && typeof obj.challenge === "string") {
    return { kind: "challenge", challenge: obj.challenge };
  }

  const ev = isPlainObject(obj.event) ? obj.event : {};
  const v2Type = typeof header?.event_type === "string" ? header.event_type : undefined;
  const v1Type = typeof ev.type === "string" ? ev.type : undefined;
  const eventType = v2Type ?? v1Type;

  // TODO verify event type name (v1 vs v2)
  const isApprovalEvent =
    eventType === "approval_instance" ||
    (eventType !== undefined && eventType.startsWith("approval.instance"));

  if (
    isApprovalEvent &&
    typeof ev.approval_code === "string" &&
    typeof ev.instance_code === "string"
  ) {
    return {
      kind: "approval_instance",
      approvalCode: ev.approval_code,
      instanceCode: ev.instance_code,
      status: String(ev.status ?? ""),
    };
  }

  return {
    kind: "other",
    eventType: eventType ?? "unknown",
  };
}
