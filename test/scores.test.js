import { strict as assert } from 'node:assert';
import { beforeEach, describe, test } from 'node:test';

// Force the in-memory store.
for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL']) {
  delete process.env[name];
}
process.env.ADMIN_CODE = 'secret';

const { GET, POST, DELETE } = await import('../api/scores.js');

const BASE = 'http://localhost/api/scores';
const ADMIN = { 'x-admin-code': 'secret' };

async function call(handler, { query = '', method = 'GET', headers = {}, body } = {}) {
  const res = await handler(new Request(BASE + query, { method, headers, body }));
  return { status: res.status, headers: res.headers, body: await res.json() };
}

const submit = (payload) =>
  call(POST, { method: 'POST', body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

beforeEach(async () => {
  await call(DELETE, { method: 'DELETE', query: '?all', headers: ADMIN });
});

describe('POST /api/scores', () => {
  test('accepts a submission and reports the team rank', async () => {
    const res = await submit({ team: 'Alpha', score: 12.5, seed: 42 });
    assert.equal(res.status, 201);
    assert.equal(res.body.submission.team, 'Alpha');
    assert.equal(res.body.submission.score, 12.5);
    assert.equal(res.body.submission.seed, '42');
    assert.equal(res.body.rank, 1);
  });

  test('keeps 64-bit numeric seeds exact', async () => {
    const res = await submit('{"team":"Alpha","score":1,"seed":18446744073709551615}');
    assert.equal(res.body.submission.seed, '18446744073709551615');
  });

  test('accepts string seeds and normalizes team whitespace', async () => {
    const res = await submit({ team: '  Team   Rocket ', score: 3, seed: 'abc-123' });
    assert.equal(res.body.submission.team, 'Team Rocket');
    assert.equal(res.body.submission.seed, 'abc-123');
  });

  for (const [name, payload, status] of [
    ['invalid JSON', '{nope', 400],
    ['a non-object body', '[1,2]', 400],
    ['a missing team', { score: 1, seed: 1 }, 400],
    ['a blank team', { team: '   ', score: 1, seed: 1 }, 400],
    ['a too-long team', { team: 'x'.repeat(65), score: 1, seed: 1 }, 400],
    ['a string score', { team: 'A', score: '1', seed: 1 }, 400],
    ['a missing score', { team: 'A', seed: 1 }, 400],
    ['a missing seed', { team: 'A', score: 1 }, 400],
    ['a null seed', { team: 'A', score: 1, seed: null }, 400],
    ['an oversized body', { team: 'A', score: 1, seed: 1, pad: 'x'.repeat(5000) }, 413],
  ]) {
    test(`rejects ${name}`, async () => {
      const res = await submit(payload);
      assert.equal(res.status, status);
      assert.ok(res.body.error);
    });
  }
});

describe('GET /api/scores', () => {
  test('ranks each team by its lowest score', async () => {
    await submit({ team: 'Alpha', score: 10, seed: 1 });
    await submit({ team: 'Bravo', score: 5, seed: 2 });
    await submit({ team: 'alpha', score: 3, seed: 3 }); // same team, different case
    await submit({ team: 'Alpha', score: 20, seed: 4 });

    const { status, headers, body } = await call(GET);
    assert.equal(status, 200);
    assert.match(headers.get('cache-control'), /s-maxage=2/);
    assert.deepEqual(
      body.leaderboard.map((r) => [r.rank, r.team, r.score, r.seed, r.runs]),
      [
        [1, 'Alpha', 3, '3', 3],
        [2, 'Bravo', 5, '2', 1],
      ],
    );
  });

  test('breaks ties in favor of the earlier submission', async () => {
    await submit({ team: 'First', score: 7, seed: 1 });
    await submit({ team: 'Second', score: 7, seed: 2 });
    const { body } = await call(GET);
    assert.deepEqual(body.leaderboard.map((r) => r.team), ['First', 'Second']);
  });
});

describe('admin', () => {
  test('requires the correct code', async () => {
    assert.equal((await call(GET, { query: '?all' })).status, 401);
    assert.equal((await call(GET, { query: '?all', headers: { 'x-admin-code': 'wrong' } })).status, 401);
    assert.equal((await call(DELETE, { method: 'DELETE', query: '?all' })).status, 401);

    const res = await call(GET, { query: '?all', headers: ADMIN });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('lists every submission, newest first', async () => {
    await submit({ team: 'Alpha', score: 1, seed: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await submit({ team: 'Alpha', score: 2, seed: 2 });
    const { body } = await call(GET, { query: '?all', headers: ADMIN });
    assert.deepEqual(body.submissions.map((s) => s.seed), ['2', '1']);
    assert.equal(body.leaderboard.length, 1);
  });

  test('deleting a best score promotes the team’s next-best run', async () => {
    const best = await submit({ team: 'Alpha', score: 1, seed: 1 });
    await submit({ team: 'Alpha', score: 2, seed: 2 });

    const res = await call(DELETE, { method: 'DELETE', query: `?id=${best.body.submission.id}`, headers: ADMIN });
    assert.deepEqual(res.body, { deleted: 1 });

    const { body } = await call(GET);
    assert.deepEqual(body.leaderboard.map((r) => [r.score, r.runs]), [[2, 1]]);
  });

  test('deleting an unknown id returns 404', async () => {
    const res = await call(DELETE, { method: 'DELETE', query: '?id=nope', headers: ADMIN });
    assert.equal(res.status, 404);
  });

  test('DELETE without ?id or ?all is rejected rather than clearing', async () => {
    await submit({ team: 'Alpha', score: 1, seed: 1 });
    assert.equal((await call(DELETE, { method: 'DELETE', headers: ADMIN })).status, 400);
    assert.equal((await call(GET)).body.leaderboard.length, 1);
  });

  test('clear removes everything', async () => {
    await submit({ team: 'Alpha', score: 1, seed: 1 });
    await submit({ team: 'Bravo', score: 2, seed: 2 });
    const res = await call(DELETE, { method: 'DELETE', query: '?all', headers: ADMIN });
    assert.deepEqual(res.body, { deleted: 2 });
    assert.deepEqual((await call(GET)).body.leaderboard, []);
  });
});
