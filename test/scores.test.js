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

// Object payloads default to the Warmup game type; string payloads are sent as-is.
const submit = (payload) =>
  call(POST, {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify({ gameType: 'Warmup', ...payload }),
  });

beforeEach(async () => {
  await call(DELETE, { method: 'DELETE', query: '?all', headers: ADMIN });
});

describe('POST /api/scores', () => {
  test('accepts a submission and reports where the run ranks', async () => {
    const res = await submit({ team: 'Alpha', score: 12.5, seed: 42 });
    assert.equal(res.status, 201);
    assert.equal(res.body.submission.team, 'Alpha');
    assert.equal(res.body.submission.score, 12.5);
    assert.equal(res.body.submission.seed, '42');
    assert.deepEqual({ rank: res.body.rank, total: res.body.total }, { rank: 1, total: 1 });
  });

  test('a team’s later run is ranked against its own earlier runs', async () => {
    await submit({ team: 'Alpha', score: 5, seed: 42 });
    const worse = await submit({ team: 'Alpha', score: 9, seed: 42 });
    assert.deepEqual({ rank: worse.body.rank, total: worse.body.total }, { rank: 2, total: 2 });
    const better = await submit({ team: 'Alpha', score: 1, seed: 42 });
    assert.deepEqual({ rank: better.body.rank, total: better.body.total }, { rank: 1, total: 3 });
  });

  test('keeps 64-bit numeric seeds exact', async () => {
    const res = await submit('{"team":"Alpha","score":1,"seed":18446744073709551615,"gameType":"Wordle"}');
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
    ['a missing gameType', '{"team":"A","score":1,"seed":1}', 400],
    ['an unknown gameType', { team: 'A', score: 1, seed: 1, gameType: 'Chess' }, 400],
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
  test('lists every run, lowest score first, including repeats from one team', async () => {
    await submit({ team: 'Alpha', score: 10, seed: 1 });
    await submit({ team: 'Bravo', score: 5, seed: 2 });
    await submit({ team: 'alpha', score: 3, seed: 3 }); // same team, different case
    await submit({ team: 'Alpha', score: 20, seed: 4 });

    const { status, headers, body } = await call(GET);
    assert.equal(status, 200);
    assert.match(headers.get('cache-control'), /s-maxage=2/);
    assert.deepEqual(
      body.leaderboard.map((r) => [r.rank, r.team, r.score, r.seed]),
      [
        [1, 'alpha', 3, '3'],
        [2, 'Bravo', 5, '2'],
        [3, 'Alpha', 10, '1'],
        [4, 'Alpha', 20, '4'],
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

describe('cost reporting', () => {
  test('stores costUsd and costSession when sent', async () => {
    const res = await submit({ team: 'Alpha', score: 1, seed: 1, costUsd: 32.9749, costSession: '23420-f23e' });
    assert.equal(res.status, 201);
    assert.equal(res.body.submission.costUsd, 32.9749);
    assert.equal(res.body.submission.costSession, '23420-f23e');
  });

  test('both fields are optional', async () => {
    const res = await submit({ team: 'Alpha', score: 1, seed: 1 });
    assert.equal(res.status, 201);
    assert.equal('costUsd' in res.body.submission, false);
    assert.equal('costSession' in res.body.submission, false);
    assert.equal((await call(GET)).body.leaderboard[0].costUsd, null);
  });

  test('each run carries its own cost', async () => {
    await submit({ team: 'Alpha', score: 5, seed: 1, costUsd: 10 });
    await submit({ team: 'Alpha', score: 2, seed: 1, costUsd: 25.5 });
    await submit({ team: 'Alpha', score: 9, seed: 1, costUsd: 99 });
    const { body } = await call(GET);
    assert.deepEqual(body.leaderboard.map((r) => [r.score, r.costUsd]), [[2, 25.5], [5, 10], [9, 99]]);
  });

  test('length limits count characters, not UTF-16 code units', async () => {
    // 65 emoji are 130 UTF-16 units but only 65 characters, so they're within the 128 limit.
    const emoji = '🙂'.repeat(65);
    const ok = await submit({ team: 'Alpha', score: 1, seed: emoji, costSession: emoji });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.submission.costSession, emoji);

    const tooLong = await submit({ team: 'Alpha', score: 1, seed: 1, costSession: '🙂'.repeat(129) });
    assert.equal(tooLong.status, 400);
  });

  for (const [name, payload] of [
    ['a non-numeric costUsd', { team: 'A', score: 1, seed: 1, costUsd: '32.97' }],
    ['a negative costUsd', { team: 'A', score: 1, seed: 1, costUsd: -1 }],
    ['a non-string costSession', { team: 'A', score: 1, seed: 1, costSession: 42 }],
    ['a blank costSession', { team: 'A', score: 1, seed: 1, costSession: '  ' }],
    ['an overlong costSession', { team: 'A', score: 1, seed: 1, costSession: 'x'.repeat(129) }],
  ]) {
    test(`rejects ${name}`, async () => {
      const res = await submit(payload);
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
    });
  }
});

describe('game types', () => {
  test('gameType matches case-insensitively and is stored canonically', async () => {
    const res = await submit({ team: 'Alpha', score: 1, seed: 1, gameType: ' wordle ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.submission.gameType, 'Wordle');
  });

  test('each game type has its own board; Warmup is the default', async () => {
    await submit({ team: 'Alpha', score: 5, seed: 1, gameType: 'Warmup' });
    await submit({ team: 'Bravo', score: 1, seed: 1, gameType: 'Wordle' });
    await submit({ team: 'Alpha', score: 2, seed: 1, gameType: 'Wordle' });

    const warmup = (await call(GET)).body;
    assert.equal(warmup.game, 'Warmup');
    assert.deepEqual(warmup.gameTypes, ['Warmup', 'Wordle']);
    assert.deepEqual(warmup.leaderboard.map((r) => [r.team, r.score]), [['Alpha', 5]]);

    const wordle = (await call(GET, { query: '?game=wordle' })).body;
    assert.equal(wordle.game, 'Wordle');
    assert.deepEqual(wordle.leaderboard.map((r) => [r.team, r.score]), [['Bravo', 1], ['Alpha', 2]]);
  });

  test('an unknown ?game is rejected', async () => {
    assert.equal((await call(GET, { query: '?game=Chess' })).status, 400);
  });

  test('POST reports rank within the submitted game type', async () => {
    await submit({ team: 'Alpha', score: 1, seed: 1, gameType: 'Warmup' });
    const res = await submit({ team: 'Bravo', score: 3, seed: 1, gameType: 'Wordle' });
    assert.equal(res.body.rank, 1); // Alpha's better score is on the other game
  });

  test('seeds are listed per game type', async () => {
    await submit({ team: 'Alpha', score: 1, seed: 'warm-seed', gameType: 'Warmup' });
    await submit({ team: 'Alpha', score: 1, seed: 'word-seed', gameType: 'Wordle' });
    const { body } = await call(GET, { query: '?game=Wordle' });
    assert.deepEqual(body.seeds.map((s) => s.seed), ['word-seed']);
  });
});

describe('seed filtering', () => {
  beforeEach(async () => {
    await submit({ team: 'Alpha', score: 1, seed: 'practice' });
    await submit({ team: 'Bravo', score: 2, seed: 'practice' });
    await new Promise((r) => setTimeout(r, 5)); // final runs come strictly later
    await submit({ team: 'Bravo', score: 9, seed: 'final' });
    await submit({ team: 'Alpha', score: 4, seed: 'final' });
    await submit({ team: 'Bravo', score: 3, seed: 'final' });
  });

  test('?seed ranks only that seed’s runs', async () => {
    const { body } = await call(GET, { query: '?seed=final' });
    assert.deepEqual(
      body.leaderboard.map((r) => [r.rank, r.team, r.score]),
      [
        [1, 'Bravo', 3],
        [2, 'Alpha', 4],
        [3, 'Bravo', 9],
      ],
    );
  });

  test('repeated ?seed params combine seeds', async () => {
    const { body } = await call(GET, { query: '?seed=final&seed=practice' });
    assert.deepEqual(body.leaderboard.map((r) => [r.team, r.score]), [
      ['Alpha', 1],
      ['Bravo', 2],
      ['Bravo', 3],
      ['Alpha', 4],
      ['Bravo', 9],
    ]);
  });

  test('an unknown seed gives an empty board', async () => {
    const { body } = await call(GET, { query: '?seed=nope' });
    assert.deepEqual(body.leaderboard, []);
  });

  test('lists every seed with counts, most recently used first, regardless of filter', async () => {
    const { body } = await call(GET, { query: '?seed=practice' });
    assert.deepEqual(
      body.seeds.map((s) => [s.seed, s.submissions, s.teams]),
      [
        ['final', 3, 2],
        ['practice', 2, 2],
      ],
    );
  });

  test('POST reports rank on the submitted seed', async () => {
    const res = await submit({ team: 'Charlie', score: 1.5, seed: 'final' });
    assert.equal(res.body.rank, 1); // would be #2 across all seeds, behind Alpha's practice 1
    assert.equal(res.body.total, 4); // the three existing final runs plus this one
  });

  test('admin ?all&seed returns only that seed’s submissions', async () => {
    const { body } = await call(GET, { query: '?all&seed=practice', headers: ADMIN });
    assert.equal(body.submissions.length, 2);
    assert.ok(body.submissions.every((s) => s.seed === 'practice'));
    assert.equal(body.seeds.length, 2);
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
    assert.equal(body.leaderboard.length, 2);
  });

  test('deleting a run removes just that row and re-ranks the rest', async () => {
    const top = await submit({ team: 'Alpha', score: 1, seed: 1 });
    await submit({ team: 'Alpha', score: 2, seed: 2 });

    const res = await call(DELETE, { method: 'DELETE', query: `?id=${top.body.submission.id}`, headers: ADMIN });
    assert.deepEqual(res.body, { deleted: 1 });

    const { body } = await call(GET);
    assert.deepEqual(body.leaderboard.map((r) => [r.rank, r.score]), [[1, 2]]);
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
