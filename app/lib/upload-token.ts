import { createHmac, timingSafeEqual } from "node:crypto";

export type UploadTokenPayload = {
  fileId: string;
  filename: string;
  size: number;
  expiresAt: number;
};

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createUploadToken(
  payload: Omit<UploadTokenPayload, "expiresAt">,
  secret: string
) {
  const complete: UploadTokenPayload = {
    ...payload,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(complete)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyUploadToken(token: unknown, secret: string): UploadTokenPayload {
  if (typeof token !== "string") throw new Error("Referência de documento inválida.");
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) throw new Error("Referência de documento inválida.");

  const expected = Buffer.from(signature(encoded, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Referência de documento inválida.");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (
    typeof payload?.fileId !== "string" ||
    !payload.fileId.startsWith("file-") ||
    typeof payload?.filename !== "string" ||
    typeof payload?.size !== "number" ||
    typeof payload?.expiresAt !== "number" ||
    payload.expiresAt < Date.now()
  ) {
    throw new Error("A referência do documento expirou. Envie os arquivos novamente.");
  }
  return payload;
}
