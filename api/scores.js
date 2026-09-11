import { randomUUID } from 'node:crypto';
import { HttpError, handle, json, requireAdmin } from '../lib/http.js';
import { MAX_SUBMISSIONS, buildLeaderboard, parseSubmission, teamKey } from '../lib/leaderboard.js';
import { getStore } from '../lib/store.js';

// GET /api/scores       public leaderboard, one row per team
// GET /api/scores?all   (admin) leaderboard plus every submission, newest first
export const GET = handle(async (request, url) => {
  if (url.searchParams.has('all')) {
    requireAdmin(request);
    const submissions = await getStore().list();
    const leaderboard = buildLeaderboard(submissions);
    submissions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return json({ leaderboard, submissions });
  }

  const leaderboard = buildLeaderboard(await getStore().list());
  // A short CDN cache absorbs polling from many open leaderboard tabs.
  return json({ leaderboard }, 200, { 'cache-control': 'public, max-age=0, s-maxage=2' });
});

// POST /api/scores  {"team": "...", "score": 1.23, "seed": 42}
export const POST = handle(async (request) => {
  const { team, score, seed } = parseSubmission(await request.text());
  const store = getStore();
  const existing = await store.list();
  if (existing.length >= MAX_SUBMISSIONS) {
    throw new HttpError(503, 'Leaderboard is full; ask an admin to clear old submissions');
  }

  const submission = { id: randomUUID(), team, score, seed, createdAt: new Date().toISOString() };
  await store.add(submission);

  const row = buildLeaderboard([...existing, submission]).find((r) => teamKey(r.team) === teamKey(team));
  return json({ submission, rank: row.rank, best: { score: row.score, seed: row.seed } }, 201);
});

// DELETE /api/scores?id=<id>  (admin) remove one submission
// DELETE /api/scores?all      (admin) clear the leaderboard
export const DELETE = handle(async (request, url) => {
  requireAdmin(request);
  const store = getStore();

  const id = url.searchParams.get('id');
  if (id) {
    if (!(await store.remove(id))) throw new HttpError(404, 'No submission with that id');
    return json({ deleted: 1 });
  }
  if (url.searchParams.has('all')) {
    return json({ deleted: await store.clear() });
  }
  throw new HttpError(400, 'Pass ?id=<submission id> to delete one submission, or ?all to clear everything');
});
