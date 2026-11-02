import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/types.js';

// A temp runs dir: runs/ itself is read-only (AGENTS.md), so tests never write there.
const runsDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
writeFileSync(
  join(runsDir, '2026-10-28.jsonl'),
  [
    '{"at":"2026-10-28T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
    '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-29T01:33:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
    '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
    '{"at":"2026-10-29T05:41:09+01:00","job":"digest/render","status":"ok","owner":null}',
    '{"at":"2026-10-29T05:59:58+01:00","job":"lane/sy',
  ].join('\n'),
);
writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');

const config = { adapter: 'shim', installed: 't', beatEverySeconds: 60, runsDir };
const app = () => createApp(config);

afterAll(() => {
  process.env.LANE_MARKER = '';
});

describe('run log reader (section 1)', () => {
  // Plan section 1 done-when, on the real fixture (read-only).
  it('reads runs/2026-10-28.jsonl into 5 jobs with 1 bad line', () => {
    const read = readNight('runs', '2026-10-28');
    expect(read).not.toBeNull();
    expect(read?.rows.length).toBe(5);
    expect(read?.badLines).toBe(1);
  });

  it('aggregates runs, retries, last status and null owner', () => {
    const rows = readNight(runsDir, '2026-10-28')?.rows ?? [];
    const refresh = rows.find((r) => r.job === 'fixtures/refresh');
    expect(refresh).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: null });
    const render = rows.find((r) => r.job === 'digest/render');
    expect(render?.owner).toBeNull();
  });

  it('returns null for a night with no file', () => {
    expect(readNight(runsDir, '1999-01-01')).toBeNull();
  });
});

describe('digest routes (sections 2a, 2b, 2d)', () => {
  it('page returns 200 and marks a fail', async () => {
    const res = await app().request('/digest/2026-10-28');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('notes/backup');
    expect(html).toContain('quota exceeded');
  });

  it('page returns 404 for a night with no file', async () => {
    const res = await app().request('/digest/1999-01-01');
    expect(res.status).toBe(404);
  });

  it('page reads "nothing ran" for an empty night', async () => {
    const res = await app().request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('JSON returns the same jobs, in the same order, as the page', async () => {
    const res = await app().request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ job: string }>;
    const fromReader = (readNight(runsDir, '2026-10-28')?.rows ?? []).map((r) => r.job);
    expect(rows.map((r) => r.job)).toEqual(fromReader);
  });

  it('JSON returns 404 for a night with no file', async () => {
    const res = await app().request('/api/digest/1999-01-01');
    expect(res.status).toBe(404);
  });
});
