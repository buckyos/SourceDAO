import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import JSONbig from "json-bigint";

const json = JSONbig({ strict: true, useNativeBigInt: true, constructorAction: "preserve" });

/** Reject duplicate keys instead of signing a parser-dependent configuration. */
export async function readJson<T = any>(filename: string): Promise<T> {
  const contents = await readFile(filename, "utf8");
  return parseJson<T>(contents, filename);
}

/** Parse the exact bytes whose release digest was checked. */
export function parseJson<T = any>(contents: string, label = "JSON"): T {
  try { return json.parse(contents) as T; } catch (error: any) {
    throw new Error(`Invalid JSON in ${label}: ${error.message ?? String(error)}`);
  }
}

export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Cannot commit undefined JSON values");
  return encoded;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Connection details and local paths do not identify a bootstrap ceremony. */
export function configDigest(config: Record<string, unknown>): string {
  const { rpcUrl, artifactsDir, outputPath, ...publicConfig } = config;
  return sha256(canonicalJson(publicConfig));
}

/** Persist before broadcasting: fsync both the replacement file and directory. */
export async function atomicJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
    await file.close();
    await rename(temporary, filename);
    const directory = await open(path.dirname(filename), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await file.close();
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

/** Publish a complete new artifact without replacing even a concurrently created file. */
export async function createJson(filename: string, value: unknown): Promise<void> {
  const staging = `${filename}.${randomUUID()}.pending`;
  try {
    await atomicJson(staging, value);
    await link(staging, filename);
    const directory = await open(path.dirname(filename), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(staging).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

/** Refuse concurrent writers; an abandoned lock needs an explicit operator check. */
export async function lockState(filename: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(filename), { recursive: true });
  const lock = `${filename}.lock`;
  let file;
  try { file = await open(lock, "wx", 0o600); } catch (error: any) {
    if (error.code === "EEXIST") throw new Error(`Bootstrap lock exists: ${lock}; verify its owner has stopped before removing it`);
    throw error;
  }
  await file.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(),
    ...(process.env.SOURCE_DAO_MANAGED_TASK_ID ? { managed_task_id: process.env.SOURCE_DAO_MANAGED_TASK_ID } : {}) }));
  await file.sync();
  await file.close();
  return () => unlink(lock);
}
