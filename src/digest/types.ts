import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Plan morning-digest § 1. The night's run log, read into one row per job.
// Committed first (DigestRow and the readNight signature) so § 2 can start against it.

export type JobStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: JobStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type StatusCounts = { ok: number; retry: number; fail: number };

// What one night's log holds, once read. `rows` is one per job, sorted by job.
// `counts` is per log line. `badLines` is lines that did not parse (counted, never thrown).
export type Night = { rows: DigestRow[]; counts: StatusCounts; badLines: number };

type Entry = { at: string; job: string; status: JobStatus; owner?: string | null; error?: string };

const STATUSES: ReadonlySet<string> = new Set(['ok', 'retry', 'fail']);

function parseEntry(line: string): Entry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.at !== 'string' || typeof e.job !== 'string' || typeof e.status !== 'string') return null;
  if (!STATUSES.has(e.status)) return null;
  const owner = e.owner === undefined ? null : e.owner;
  if (owner !== null && typeof owner !== 'string') return null;
  const error = typeof e.error === 'string' ? e.error : undefined;
  return { at: e.at, job: e.job, status: e.status as JobStatus, owner, error };
}

// Read runs/<night>.jsonl. Returns null when the file is missing (the page answers 404),
// an empty `rows` when the file is empty (the page reads "nothing ran").
export function readNight(runsDir: string, night: string): Night | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }

  const byJob = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const entry = parseEntry(line);
    if (entry === null) {
      badLines += 1;
      continue;
    }
    counts[entry.status] += 1;

    const row = byJob.get(entry.job);
    if (row === undefined) {
      byJob.set(entry.job, {
        job: entry.job,
        owner: entry.owner ?? null,
        runs: 1,
        retries: entry.status === 'retry' ? 1 : 0,
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        firstAt: entry.at,
        lastAt: entry.at,
      });
      continue;
    }

    row.runs += 1;
    if (entry.status === 'retry') row.retries += 1;
    if (entry.owner !== null && entry.owner !== undefined) row.owner = entry.owner;
    if (entry.at < row.firstAt) row.firstAt = entry.at;
    if (entry.at >= row.lastAt) {
      row.lastAt = entry.at;
      row.lastStatus = entry.status;
      row.lastError = entry.error ?? null;
    }
  }

  const rows = [...byJob.values()].sort((a, b) => a.job.localeCompare(b.job));
  return { rows, counts, badLines };
}
