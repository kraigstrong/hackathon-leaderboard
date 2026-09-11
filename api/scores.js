import { randomUUID } from 'node:crypto';
import { HttpError, handle, json, requireAdmin } from '../lib/http.js';
import {
  MAX_SUBMISSIONS,
  buildLeaderboard,
  filterBySeeds,
  parseSubmission,
  summarizeSeeds,
  teamKey,
} from '../lib/leaderboard.js';
import { getStore } from '../lib/store.js';

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

// GET /api/scores                 public leaderboard, one row per team, plus every seed seen
// GET /api/scores?seed=X&seed=Y   leaderboard counting only those seeds
// GET /api/scores?all             (admin) also returns every matching submission, newest first
export const GET = handle(async (request, url) => {
  const admin = url.searchParams.has('all');
  if (admin) requireAdmin(request);

  const all = await getStore().list();
  const seeds = url.searchParams.getAll('seed').map((s) => s.trim()).filter(Boolean);
  const submissions = filterBySeeds(all, seeds);
  const body = { leaderboard: buildLeaderboard(submissions), seeds: summarizeSeeds(all) };

  if (admin) return json({ ...body, submissions: [...submissions].sort(newestFirst) });
  // A short CDN cache absorbs polling from many open leaderboard tabs.
  return json(body, 200, { 'cache-control': 'public, max-age=0, s-maxage=2' });
});

// POST /api/scores  {"team": "...", "score": 1.23, "seed": 42}
// Responds with the team's rank and best score on that seed.
export const POST = handle(async (request) => {
  const { team, score, seed } = parseSubmission(await request.text());
  const store = getStore();
  const existing = await store.list();
  if (existing.length >= MAX_SUBMISSIONS) {
    throw new HttpError(503, 'Leaderboard is full; ask an admin to clear old submissions');
  }

  const submission = { id: randomUUID(), team, score, seed, createdAt: new Date().toISOString() };
  await store.add(submission);

  const board = buildLeaderboard(filterBySeeds([...existing, submission], [seed]));
  const row = board.find((r) => teamKey(r.team) === teamKey(team));
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
