import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/types.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  // Plan morning-digest section 2a. The page for one night; a missing file is a 404.
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const read = readNight(config.runsDir, night);
    if (read === null) {
      return c.html(
        <Layout title={`digest \u00b7 ${night}`} lane={lane()}>
          <h1>digest · {night}</h1>
          <p class="warn">no run log for this night</p>
        </Layout>,
        404,
      );
    }
    return c.html(
      <Layout title={`digest \u00b7 ${night}`} lane={lane()}>
        <Digest night={night} rows={read.rows} />
      </Layout>,
    );
  });

  // Plan morning-digest section 2b. JSON rows; page and JSON must never disagree (ADR 0001).
  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    const read = readNight(config.runsDir, night);
    if (read === null) return c.json({ error: 'no run log for this night' }, 404);
    return c.json(read.rows);
  });

  return app;
}
