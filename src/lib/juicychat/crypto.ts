import { createCipheriv, createDecipheriv, randomUUID } from "node:crypto";

const KEY = Buffer.from("yume1aJ83ZbPpkwb", "utf8");
const IV = Buffer.from("yume2024cccydnzc", "utf8");

export function encryptRequestPayload(plain: string): string {
  const b64 = Buffer.from(plain, "utf8").toString("base64");
  const cipher = createCipheriv("aes-128-cbc", KEY, IV);
  return Buffer.concat([cipher.update(b64, "utf8"), cipher.final()]).toString("base64");
}

export function decryptResponsePayload(b64cipher: string): string {
  const decipher = createDecipheriv("aes-128-cbc", KEY, IV);
  const dec = Buffer.concat([
    decipher.update(Buffer.from(b64cipher, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return Buffer.from(dec, "base64").toString("utf8");
}

/** JuicyChat SecretKey format: UUID without dashes + 2 inserted chars. */
export function createJuicySecretKey(): string {
  const base = randomUUID().replace(/-/g, "").split("");
  const a = ["m", "t", "6", "6"][Math.floor(Math.random() * 4)]!;
  const b = ["4", "g", "l", "l"][Math.floor(Math.random() * 4)]!;
  base.splice(5, 0, a);
  base.splice(10, 0, b);
  return base.join("");
}
