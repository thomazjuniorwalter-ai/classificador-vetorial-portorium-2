import { createHmac, timingSafeEqual } from "node:crypto";

export type MultipartSession = {
  kind: "multipart-session"; uploadId: string; filename: string; size: number; owner: string; expiresAt: number;
};
export type MultipartPart = {
  kind: "multipart-part"; uploadId: string; partId: string; index: number; size: number; owner: string; expiresAt: number;
};

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(`multipart:${value}`).digest("base64url");
}

export function signMultipart(payload: MultipartSession | MultipartPart, secret: string) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyMultipart<K extends MultipartSession["kind"] | MultipartPart["kind"]>(
  token: unknown, kind: K, owner: string, secret: string
): Extract<MultipartSession | MultipartPart, { kind: K }> {
  if (typeof token !== "string" || token.length > 4096) throw new Error("Referência de envio inválida.");
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra) throw new Error("Referência de envio inválida.");
  const expected = Buffer.from(signature(encoded, secret)), actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Referência de envio inválida.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.kind !== kind || payload.owner !== owner || !/^upload_[\w-]+$/.test(payload.uploadId) || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) {
    throw new Error("O envio expirou ou pertence a outra sessão. Envie o arquivo novamente.");
  }
  return payload;
}
