import { randomUUID } from 'node:crypto';
import { HttpError, handle, json, requireAdmin } from '../lib/http.js';
import {
  GAME_TYPES,
  MAX_SUBMISSIONS,
  buildLeaderboard,
  filterByGameType,
  filterBySeeds,
  matchGameType,
  parseSubmission,
  summarizeSeeds,
  teamKey,
} from '../lib/leaderboard.js';
import { getStore } from '../lib/store.js';

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

// GET /api/scores?game=Wordle            one game type's leaderboard (defaults to the first game type)
//                 &seed=X&seed=Y         counting only those seeds
// GET /api/scores?all&game=...&seed=...  (admin) also returns every matching submission, newest first
// Responses also list the game types and every seed seen for the selected game type.
export const GET = handle(async (request, url) => {
  const admin = url.searchParams.has('all');
  if (admin) requireAdmin(request);

  const gameParam = url.searchParams.get('game');
  const game = gameParam ? matchGameType(gameParam) : GAME_TYPES[0];
  if (!game) throw new HttpError(400, `game must be one of: ${GAME_TYPES.join(', ')}`);

  const inGame = filterByGameType(await getStore().list(), game);
  const seeds = url.searchParams.getAll('seed').map((s) => s.trim()).filter(Boolean);
  const submissions = filterBySeeds(inGame, seeds);
  const body = {
    game,
    gameTypes: GAME_TYPES,
    leaderboard: buildLeaderboard(submissions),
    seeds: summarizeSeeds(inGame),
  };

  if (admin) return json({ ...body, submissions: [...submissions].sort(newestFirst) });
  // A short CDN cache absorbs polling from many open leaderboard tabs.
  return json(body, 200, { 'cache-control': 'public, max-age=0, s-maxage=2' });
});

// POST /api/scores  {"team": "...", "score": 1.23, "seed": 42, "gameType": "Wordle"}
//                   optionally with {"costUsd": 32.97, "costSession": "23420-f23e"}
// Responds with the team's rank and best score for that game type and seed.
export const POST = handle(async (request) => {
  const fields = parseSubmission(await request.text());
  const { team, seed, gameType } = fields;
  const store = getStore();
  const existing = await store.list();
  if (existing.length >= MAX_SUBMISSIONS) {
    throw new HttpError(503, 'Leaderboard is full; ask an admin to clear old submissions');
  }

  const submission = { id: randomUUID(), ...fields, createdAt: new Date().toISOString() };
  await store.add(submission);

  const board = buildLeaderboard(filterBySeeds(filterByGameType([...existing, submission], gameType), [seed]));
  const row = board.find((r) => teamKey(r.team) === teamKey(team));
  return json({ submission, rank: row.rank, best: { score: row.score, seed: row.seed } }, 201);
});

// DELETE /api/scores?id=<id>  (admin) remove one submission
// DELETE /api/scores?all      (admin) clear the leaderboard, every game type
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
