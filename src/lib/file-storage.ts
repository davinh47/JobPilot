import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { isCloudDeployment } from "@/lib/deployment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bucket = process.env.SUPABASE_RESUME_BUCKET ?? "resumes";
let bucketReady: Promise<void> | null = null;

async function ensureResumeBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { error } = await createSupabaseAdminClient().storage.createBucket(bucket, {
        public: false,
        allowedMimeTypes: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/plain",
        ],
      });
      if (error && !/already exists/i.test(error.message)) {
        throw new Error(`Unable to prepare resume storage: ${error.message}`);
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  await bucketReady;
}

function contentType(extension: string) {
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "text/plain; charset=utf-8";
}

export async function saveResumeSource(input: { userId: string; bytes: Buffer; hash: string; extension: string }) {
  if (isCloudDeployment) {
    await ensureResumeBucket();
    const storagePath = `${input.userId}/${input.hash}.${input.extension}`;
    const { error } = await createSupabaseAdminClient().storage.from(bucket).upload(storagePath, input.bytes, {
      contentType: contentType(input.extension),
      upsert: false,
    });
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Unable to store resume source: ${error.message}`);
    return { storagePath: `supabase://${bucket}/${storagePath}`, created: !error };
  }

  const uploadDir = resolve("data/uploads");
  const storagePath = `data/uploads/${input.hash}.${input.extension}`;
  await mkdir(uploadDir, { recursive: true });
  try {
    await writeFile(resolve(storagePath), input.bytes, { flag: "wx" });
    return { storagePath, created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { storagePath, created: false };
    throw error;
  }
}

function cloudObject(storagePath: string) {
  const match = /^supabase:\/\/([^/]+)\/(.+)$/.exec(storagePath);
  if (!match) throw new Error("Invalid cloud storage path.");
  return { bucketName: match[1], objectPath: match[2] };
}

export async function readResumeSource(storagePath: string) {
  if (storagePath.startsWith("supabase://")) {
    const object = cloudObject(storagePath);
    const { data, error } = await createSupabaseAdminClient().storage.from(object.bucketName).download(object.objectPath);
    if (error) throw new Error(`Unable to read resume source: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  const sourcePath = resolve(storagePath);
  const uploadsRoot = resolve("data/uploads");
  if (!sourcePath.startsWith(`${uploadsRoot}${sep}`)) throw new Error("Invalid resume storage path.");
  return readFile(sourcePath);
}

export async function deleteResumeSource(storagePath: string) {
  if (storagePath.startsWith("supabase://")) {
    const object = cloudObject(storagePath);
    const { error } = await createSupabaseAdminClient().storage.from(object.bucketName).remove([object.objectPath]);
    if (error) throw new Error(`Unable to delete resume source: ${error.message}`);
    return;
  }
  const sourcePath = resolve(storagePath);
  const uploadsRoot = resolve("data/uploads");
  if (!sourcePath.startsWith(`${uploadsRoot}${sep}`)) return;
  await unlink(sourcePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
