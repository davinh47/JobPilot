import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userSecrets } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";
import { isCloudDeployment, requireCloudEnvironment } from "@/lib/deployment";

const secretsPath = resolve("data/secrets.json");

const localSecretsSchema = z.object({
  deepseekApiKey: z.string().max(20_000).optional(),
  openaiApiKey: z.string().max(20_000).optional(),
  extensionPairingToken: z.string().min(24).max(256).optional(),
});

export type LocalSecrets = z.infer<typeof localSecretsSchema>;
let mutationQueue: Promise<void> = Promise.resolve();

function decodeCloudEncryptionKey(encoded: string, name: string) {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key.`);
  return key;
}

function cloudEncryptionKeyring() {
  const currentVersion = process.env.JOBPILOT_SECRETS_KEY_VERSION?.trim() || "v1";
  const encodedKeys: Record<string, string> = {};
  if (process.env.JOBPILOT_SECRETS_KEYS) {
    const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(process.env.JOBPILOT_SECRETS_KEYS));
    if (!parsed.success) throw new Error("JOBPILOT_SECRETS_KEYS must be a JSON object of versioned base64 keys.");
    Object.assign(encodedKeys, parsed.data);
  }
  encodedKeys[currentVersion] = requireCloudEnvironment("JOBPILOT_SECRETS_KEY");
  const key = decodeCloudEncryptionKey(encodedKeys[currentVersion], "JOBPILOT_SECRETS_KEY");
  if (key.length !== 32) throw new Error("JOBPILOT_SECRETS_KEY must be a base64-encoded 32-byte key.");
  return {
    currentVersion,
    currentKey: key,
    keyFor(version: string) {
      const encoded = encodedKeys[version];
      if (!encoded) throw new Error(`No decryption key is configured for secrets key version ${version}.`);
      return decodeCloudEncryptionKey(encoded, `JOBPILOT_SECRETS_KEYS.${version}`);
    },
  };
}

export function extensionPairingTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function resolveCloudUserId(userId?: string) {
  if (userId) return userId;
  return (await getCurrentUser())?.id;
}

async function readCloudSecrets(userId?: string): Promise<LocalSecrets> {
  const resolvedUserId = await resolveCloudUserId(userId);
  if (!resolvedUserId) return {};
  const stored = await db.select().from(userSecrets).where(eq(userSecrets.userId, resolvedUserId)).get();
  if (!stored) return {};
  const keyring = cloudEncryptionKeyring();
  const keyVersion = stored.encryptionKeyVersion || "v1";
  const decipher = createDecipheriv("aes-256-gcm", keyring.keyFor(keyVersion), Buffer.from(stored.initializationVector, "base64"));
  if (stored.encryptionEnvelopeVersion >= 2) {
    decipher.setAAD(Buffer.from(`jobpilot:user-secrets:${resolvedUserId}:${keyVersion}`));
  }
  decipher.setAuthTag(Buffer.from(stored.authenticationTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(stored.encryptedPayload, "base64")),
    decipher.final(),
  ]);
  const parsed = localSecretsSchema.parse(JSON.parse(plaintext.toString("utf8")));
  if (keyVersion !== keyring.currentVersion || stored.encryptionEnvelopeVersion < 2) {
    await writeCloudSecrets(resolvedUserId, parsed);
  }
  return parsed;
}

async function writeCloudSecrets(userId: string, secrets: LocalSecrets) {
  const keyring = cloudEncryptionKeyring();
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.currentKey, initializationVector);
  cipher.setAAD(Buffer.from(`jobpilot:user-secrets:${userId}:${keyring.currentVersion}`));
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);
  const values = {
    encryptedPayload: encryptedPayload.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: keyring.currentVersion,
    encryptionEnvelopeVersion: 2,
    extensionPairingTokenHash: secrets.extensionPairingToken ? extensionPairingTokenHash(secrets.extensionPairingToken) : null,
    updatedAt: new Date(),
  };
  const existing = await db.select({ id: userSecrets.id }).from(userSecrets).where(eq(userSecrets.userId, userId)).get();
  if (existing) await db.update(userSecrets).set(values).where(eq(userSecrets.id, existing.id)).run();
  else await db.insert(userSecrets).values({ userId, ...values }).run();
}

export async function readLocalSecrets(userId?: string): Promise<LocalSecrets> {
  if (isCloudDeployment) return readCloudSecrets(userId);
  try {
    return localSecretsSchema.parse(JSON.parse(await readFile(secretsPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeLocalSecrets(secrets: LocalSecrets, userId?: string) {
  if (isCloudDeployment) {
    const resolvedUserId = await resolveCloudUserId(userId);
    if (!resolvedUserId) throw new Error("A signed-in account is required to store API keys.");
    await writeCloudSecrets(resolvedUserId, secrets);
    return;
  }
  await mkdir(dirname(secretsPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(secretsPath), 0o700);
  const temporaryPath = `${secretsPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, secretsPath);
    await chmod(secretsPath, 0o600);
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function mutateLocalSecrets<T>(mutation: (secrets: LocalSecrets) => { value: T; changed: boolean }, userId?: string) {
  const operation = mutationQueue.then(async () => {
    const secrets = await readLocalSecrets(userId);
    const result = mutation(secrets);
    if (result.changed) await writeLocalSecrets(secrets, userId);
    return result.value;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function hasDeepSeekApiKey(userId?: string) {
  const secrets = await readLocalSecrets(userId);
  return Boolean(secrets.deepseekApiKey);
}

export async function saveDeepSeekApiKey(apiKey: string | null, userId?: string) {
  await mutateLocalSecrets((secrets) => {
    const previous = secrets.deepseekApiKey;
    if (apiKey) secrets.deepseekApiKey = apiKey;
    else delete secrets.deepseekApiKey;
    return { value: undefined, changed: previous !== apiKey };
  }, userId);
}

export async function hasOpenAiApiKey(userId?: string) {
  const secrets = await readLocalSecrets(userId);
  return Boolean(secrets.openaiApiKey);
}

export async function saveOpenAiApiKey(apiKey: string | null, userId?: string) {
  await mutateLocalSecrets((secrets) => {
    const previous = secrets.openaiApiKey;
    if (apiKey) secrets.openaiApiKey = apiKey;
    else delete secrets.openaiApiKey;
    return { value: undefined, changed: previous !== apiKey };
  }, userId);
}

export async function hasAiProviderKey(provider: string, userId?: string) {
  if (provider === "openai") return hasOpenAiApiKey(userId);
  if (provider === "deepseek") return hasDeepSeekApiKey(userId);
  return false;
}

export async function getOrCreateExtensionPairingToken(userId?: string) {
  const token = await mutateLocalSecrets((secrets) => {
    if (secrets.extensionPairingToken) return { value: secrets.extensionPairingToken, changed: false };
    secrets.extensionPairingToken = randomBytes(24).toString("base64url");
    return { value: secrets.extensionPairingToken, changed: true };
  }, userId);
  if (isCloudDeployment) {
    const resolvedUserId = await resolveCloudUserId(userId);
    if (resolvedUserId) {
      await db.update(userSecrets)
        .set({ extensionPairingTokenHash: extensionPairingTokenHash(token), updatedAt: new Date() })
        .where(eq(userSecrets.userId, resolvedUserId))
        .run();
    }
  }
  return token;
}

export async function rotateExtensionPairingToken(userId?: string) {
  return mutateLocalSecrets((secrets) => {
    secrets.extensionPairingToken = randomBytes(24).toString("base64url");
    return { value: secrets.extensionPairingToken, changed: true };
  }, userId);
}

export async function findUserIdByExtensionPairingToken(token: string) {
  if (!token) return undefined;
  if (!isCloudDeployment) return (await getCurrentUser())?.id;
  const row = await db.select({ userId: userSecrets.userId })
    .from(userSecrets)
    .where(eq(userSecrets.extensionPairingTokenHash, extensionPairingTokenHash(token)))
    .get();
  if (!row) return undefined;
  const expected = (await readCloudSecrets(row.userId)).extensionPairingToken ?? "";
  const receivedBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
    ? row.userId
    : undefined;
}
