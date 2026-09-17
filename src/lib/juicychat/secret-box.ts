import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const secret =
    process.env.BETTER_AUTH_SECRET?.trim() ||
    process.env.LOUNGE_SECRET?.trim() ||
    "juicy-lounge-dev-secret";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a UTF-8 string. Output is `v1.<iv_b64>.<tag_b64>.<ct_b64>`. */
export function sealString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function openString(sealed: string): string {
  if (!sealed.startsWith("v1.")) return sealed;
  const parts = sealed.split(".");
  if (parts.length !== 4) throw new Error("Bad sealed payload");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function sealJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.cookie !== "string" || !obj.cookie) return value;
  return { ...obj, cookie: sealString(obj.cookie), cookieSealed: true };
}

export function openJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (obj.cookieSealed === true && typeof obj.cookie === "string") {
    try {
      return { ...obj, cookie: openString(obj.cookie), cookieSealed: undefined };
    } catch {
      return value;
    }
  }
  return value;
}
