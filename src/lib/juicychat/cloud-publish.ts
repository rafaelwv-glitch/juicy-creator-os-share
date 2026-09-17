import { getSql } from "@/lib/db";
import { publishCharacters, type PublishResult } from "./publish-bots";
import { saveSession, type JuicySession } from "./session";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { currentLoungeUserId, dataPath, ensureDataDir } from "./paths";

export type CloudPublishJob = {
  id: string;
  characterId: string;
  characterName: string;
  fireAtMs: number;
  status: "scheduled" | "running" | "published" | "failed" | "cancelled";
  resultMessage?: string | null;
  createdAt?: string | null;
  resultAtMs?: number | null;
  userId?: string | null;
};

function newId() {
  return `jl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function jobsFile() {
  return dataPath("publish-jobs.json");
}

function writeJobsFile(jobs: CloudPublishJob[]) {
  try {
    ensureDataDir();
    writeFileSync(jobsFile(), JSON.stringify(jobs), "utf8");
  } catch {
    /* */
  }
}

function readJobsFile(): CloudPublishJob[] {
  try {
    const p = jobsFile();
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8")) as CloudPublishJob[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function asJob(row: {
  id: string;
  character_id: string;
  character_name: string;
  fire_at_ms: number;
  status: string;
  result_message: string | null;
  created_at: string | Date | null;
  result_at: string | Date | null;
  user_id?: string | null;
}): CloudPublishJob {
  const resultAt = row.result_at ? new Date(row.result_at).getTime() : null;
  return {
    id: row.id,
    characterId: row.character_id,
    characterName: row.character_name,
    fireAtMs: Number(row.fire_at_ms),
    status: row.status as CloudPublishJob["status"],
    resultMessage: row.result_message,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    resultAtMs: resultAt && Number.isFinite(resultAt) ? resultAt : null,
    userId: row.user_id || null,
  };
}

export async function listCloudJobs(): Promise<CloudPublishJob[]> {
  const uid = currentLoungeUserId();
  try {
    const sql = await getSql();
    const rows = uid
      ? await sql.query<{
          id: string;
          character_id: string;
          character_name: string;
          fire_at_ms: number;
          status: string;
          result_message: string | null;
          created_at: string | Date | null;
          result_at: string | Date | null;
          user_id: string | null;
        }>(
          `select id, character_id, character_name, fire_at_ms, status, result_message, created_at, result_at, user_id
           from lounge_publish_jobs
           where user_id = $1
           order by fire_at_ms asc`,
          [uid],
        )
      : await sql.query<{
          id: string;
          character_id: string;
          character_name: string;
          fire_at_ms: number;
          status: string;
          result_message: string | null;
          created_at: string | Date | null;
          result_at: string | Date | null;
          user_id: string | null;
        }>(
          `select id, character_id, character_name, fire_at_ms, status, result_message, created_at, result_at, user_id
           from lounge_publish_jobs
           order by fire_at_ms asc`,
        );
    const jobs = rows.map(asJob);
    writeJobsFile(jobs);
    return jobs;
  } catch (e) {
    console.warn("[lounge] list jobs from sql failed, using file", e);
    return readJobsFile();
  }
}

export async function replaceJobsFromBackup(raw: unknown): Promise<number> {
  if (!Array.isArray(raw)) return 0;
  const uid = currentLoungeUserId();
  const jobs: CloudPublishJob[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const j = item as Partial<CloudPublishJob>;
    if (!j.id || !j.characterId) continue;
    jobs.push({
      id: String(j.id),
      characterId: String(j.characterId),
      characterName: String(j.characterName || j.characterId),
      fireAtMs: Number(j.fireAtMs) || 0,
      status: (j.status as CloudPublishJob["status"]) || "scheduled",
      resultMessage: j.resultMessage ?? null,
      createdAt: j.createdAt ?? null,
      resultAtMs: j.resultAtMs ?? null,
      userId: uid || j.userId || null,
    });
  }
  writeJobsFile(jobs);
  try {
    const sql = await getSql();
    if (uid) {
      await sql.query(`delete from lounge_publish_jobs where user_id = $1`, [uid]);
    } else {
      await sql.query(`delete from lounge_publish_jobs where user_id is null`);
    }
    for (const j of jobs) {
      await sql.query(
        `insert into lounge_publish_jobs (id, character_id, character_name, fire_at_ms, status, result_message, result_at, user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           character_id = excluded.character_id,
           character_name = excluded.character_name,
           fire_at_ms = excluded.fire_at_ms,
           status = excluded.status,
           result_message = excluded.result_message,
           result_at = excluded.result_at,
           user_id = excluded.user_id`,
        [
          j.id,
          j.characterId,
          j.characterName,
          j.fireAtMs,
          j.status,
          j.resultMessage,
          j.resultAtMs ? new Date(j.resultAtMs).toISOString() : null,
          j.userId,
        ],
      );
    }
  } catch (e) {
    console.warn("[lounge] replace jobs sql failed", e);
  }
  return jobs.length;
}

export async function scheduleCloudJob(input: {
  characterId: string;
  characterName?: string;
  fireAtMs: number;
  session?: JuicySession | null;
}): Promise<CloudPublishJob> {
  const characterId = String(input.characterId || "").trim();
  if (!characterId) throw new Error("Missing character id");
  let fireAtMs = Math.floor(Number(input.fireAtMs) || 0);
  const min = Date.now() + 10_000;
  if (!Number.isFinite(fireAtMs) || fireAtMs < min) fireAtMs = min;
  if (input.session?.cookie) saveSession(input.session);

  const id = newId();
  const name = String(input.characterName || characterId);
  const uid = currentLoungeUserId();
  try {
    const sql = await getSql();
    if (uid) {
      await sql.query(
        `update lounge_publish_jobs
         set status = 'cancelled', result_at = now(), result_message = 'replaced'
         where character_id = $1 and status = 'scheduled' and user_id = $2`,
        [characterId, uid],
      );
    } else {
      await sql.query(
        `update lounge_publish_jobs
         set status = 'cancelled', result_at = now(), result_message = 'replaced'
         where character_id = $1 and status = 'scheduled'`,
        [characterId],
      );
    }
    await sql.query(
      `insert into lounge_publish_jobs (id, character_id, character_name, fire_at_ms, status, user_id)
       values ($1, $2, $3, $4, 'scheduled', $5)`,
      [id, characterId, name, fireAtMs, uid],
    );
  } catch (e) {
    console.warn("[lounge] schedule sql failed, using file", e);
  }
  const job: CloudPublishJob = {
    id,
    characterId,
    characterName: name,
    fireAtMs,
    status: "scheduled",
    resultMessage: null,
    createdAt: new Date().toISOString(),
    resultAtMs: null,
    userId: uid,
  };
  const existing = readJobsFile().filter(
    (j) => !(j.characterId === characterId && j.status === "scheduled"),
  );
  existing.push(job);
  writeJobsFile(existing);
  return job;
}

export async function cancelCloudJob(id: string): Promise<boolean> {
  const uid = currentLoungeUserId();
  let ok = false;
  try {
    const sql = await getSql();
    const rows = uid
      ? await sql.query<{ id: string }>(
          `update lounge_publish_jobs
           set status = 'cancelled', result_at = now(), result_message = 'cancelled'
           where id = $1 and user_id = $2 and status in ('scheduled', 'running')
           returning id`,
          [id, uid],
        )
      : await sql.query<{ id: string }>(
          `update lounge_publish_jobs
           set status = 'cancelled', result_at = now(), result_message = 'cancelled'
           where id = $1 and status in ('scheduled', 'running')
           returning id`,
          [id],
        );
    ok = rows.length > 0;
  } catch {
    /* */
  }
  const jobs = readJobsFile();
  let fileOk = false;
  for (const j of jobs) {
    if (j.id === id && (j.status === "scheduled" || j.status === "running")) {
      j.status = "cancelled";
      j.resultMessage = "cancelled";
      j.resultAtMs = Date.now();
      fileOk = true;
    }
  }
  if (fileOk) writeJobsFile(jobs);
  return ok || fileOk;
}

export async function fireDuePublishJobs(): Promise<{
  fired: number;
  results: PublishResult[];
}> {
  const uid = currentLoungeUserId();
  let due: { id: string; character_id: string; character_name: string }[] = [];
  try {
    const sql = await getSql();
    due = uid
      ? await sql.query(
          `select id, character_id, character_name
           from lounge_publish_jobs
           where status = 'scheduled' and fire_at_ms <= $1 and user_id = $2
           order by fire_at_ms asc
           limit 20`,
          [Date.now(), uid],
        )
      : await sql.query(
          `select id, character_id, character_name
           from lounge_publish_jobs
           where status = 'scheduled' and fire_at_ms <= $1
           order by fire_at_ms asc
           limit 20`,
          [Date.now()],
        );
    if (due.length) {
      for (const row of due) {
        await sql.query(`update lounge_publish_jobs set status = 'running' where id = $1`, [row.id]);
      }
    }
  } catch {
    const now = Date.now();
    const jobs = readJobsFile();
    due = jobs
      .filter((j) => j.status === "scheduled" && j.fireAtMs <= now)
      .slice(0, 20)
      .map((j) => ({ id: j.id, character_id: j.characterId, character_name: j.characterName }));
  }
  if (!due.length) {
    const now = Date.now();
    const jobs = readJobsFile();
    due = jobs
      .filter((j) => j.status === "scheduled" && j.fireAtMs <= now)
      .slice(0, 20)
      .map((j) => ({ id: j.id, character_id: j.characterId, character_name: j.characterName }));
  }
  if (!due.length) return { fired: 0, results: [] };

  const charIds = due.map((d) => d.character_id);
  let published: PublishResult[] = [];
  try {
    const out = await publishCharacters(charIds);
    published = out.results;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    published = due.map((d) => ({
      characterId: d.character_id,
      characterName: d.character_name,
      ok: false,
      message: msg,
    }));
  }

  const byId = new Map(published.map((r) => [r.characterId, r]));
  const fileJobs = readJobsFile();
  try {
    const sql = await getSql();
    for (const job of due) {
      const r = byId.get(job.character_id);
      const ok = Boolean(r?.ok);
      await sql.query(
        `update lounge_publish_jobs
         set status = $2, result_message = $3, result_at = now()
         where id = $1`,
        [job.id, ok ? "published" : "failed", r?.message || (ok ? "Published" : "failed")],
      );
    }
  } catch {
    /* */
  }
  for (const job of due) {
    const r = byId.get(job.character_id);
    const ok = Boolean(r?.ok);
    const fj = fileJobs.find((j) => j.id === job.id);
    if (fj) {
      fj.status = ok ? "published" : "failed";
      fj.resultMessage = r?.message || (ok ? "Published" : "failed");
      fj.resultAtMs = Date.now();
    }
  }
  writeJobsFile(fileJobs);
  return { fired: due.length, results: published };
}
