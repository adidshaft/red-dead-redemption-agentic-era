import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function createKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function createOkxSignature({
  secret,
  timestamp,
  method,
  requestPath,
  body,
}: {
  secret: string;
  timestamp: string;
  method: string;
  requestPath: string;
  body?: string;
}) {
  return createHmac("sha256", secret)
    .update(`${timestamp}${method.toUpperCase()}${requestPath}${body ?? ""}`)
    .digest("base64");
}

export function encryptSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(value: string, secret: string) {
  const payload = Buffer.from(value, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", createKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function createSessionToken(payload: string, secret: string) {
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature}`;
}

export function verifySessionToken(token: string, secret: string) {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }

  const payload = Buffer.from(payloadBase64, "base64url").toString("utf8");
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature !== expectedSignature) {
    return null;
  }

  return payload;
}
