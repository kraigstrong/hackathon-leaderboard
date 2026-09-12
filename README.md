# Hackathon Leaderboard

A live leaderboard for the hackathon. Evaluation binaries POST a team name, score, seed, and game type; the board shows
each team's best (lowest) score, with the cost of that run when the bot reports one. Each game type (**Warmup** and
**Wordle**) has its own board, and viewers can narrow a board to specific seeds. An admin page, protected by an access
code, can delete single submissions or clear the board.

## Boards and seeds

The board has a Warmup | Wordle toggle and a seed dropdown. Both choices live in the URL, so a view can be bookmarked
or left on a projector:

- `/?game=Wordle` shows every Wordle seed.
- `/?game=Wordle&seed=987654321` shows only runs on that seed. This works before anyone has submitted with the seed,
  so you can set up the final-scoring view ahead of time.

The game types are defined in `GAME_TYPES` in [`lib/leaderboard.js`](lib/leaderboard.js); the first is the default.

Static HTML plus one Vercel function (`api/scores.js`), with scores stored in Upstash Redis. No npm dependencies.

## Deploy to Vercel

1. Create the Vercel project and connect this GitHub repo:
   ```bash
   npx vercel link --project hackathon-leaderboard
   ```
2. Add a free Upstash Redis database and connect it to the project. This sets the `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` env vars. `autoUpgrade=false` keeps it from moving to a paid plan if it hits the free limits.
   ```bash
   npx vercel integration add upstash/upstash-kv --plan free -m primaryRegion=iad1 -m autoUpgrade=false
   ```
3. Set the admin access code:
   ```bash
   npx vercel env add ADMIN_CODE production
   ```
4. Push to `main`. Vercel deploys every push to production.

Point the evaluation binaries at the **production** URL. Vercel's Deployment Protection covers preview URLs by default
and would block their POSTs; if you've enabled it for production too, turn that off.

## Run locally

```bash
npm run dev
```

Serves the board at http://localhost:3000 and the admin page at http://localhost:3000/admin (access code `dev`, or set
`ADMIN_CODE`). Scores are kept in memory and lost on restart; set the Upstash env vars to use real storage.

```bash
npm test
```

## API

### `POST /api/scores`: submit a score (open)

```bash
curl -X POST https://hackathon-leaderboard-alpha.vercel.app/api/scores \
  -H 'content-type: application/json' \
  -d '{"team": "Team Rocket", "score": 0.1234, "seed": 42, "gameType": "Wordle",
       "costUsd": 32.9749, "costSession": "23420-f23e"}'
```

| Field         | Type             | Rules                                                                      |
|---------------|------------------|----------------------------------------------------------------------------|
| `team`        | string           | 1–64 characters. Case and extra whitespace are ignored for grouping.       |
| `score`       | number           | Finite. **Lower is better.**                                               |
| `seed`        | number or string | Required, up to 128 characters. Stored exactly, including 64-bit integers. |
| `gameType`    | string           | `Warmup` or `Wordle` (any case). Anything else is rejected.                |
| `costUsd`     | number           | Optional. Non-negative. Shown on the board for each team's best run.       |
| `costSession` | string           | Optional. Up to 128 characters. Shown on the admin page.                   |

Returns `201` with the team's rank and best score for that game type and seed:

```json
{
  "submission": {
    "id": "…", "team": "Team Rocket", "score": 0.1234, "seed": "42", "gameType": "Wordle",
    "costUsd": 32.9749, "costSession": "23420-f23e", "createdAt": "…"
  },
  "rank": 3,
  "best": { "score": 0.1234, "seed": "42" }
}
```

Errors return `4xx` with `{"error": "…"}`. See [`examples/submit.go`](examples/submit.go) for a Go client.

### `GET /api/scores`: leaderboard (open)

| Query                 | Effect                                                                     |
|-----------------------|----------------------------------------------------------------------------|
| `game=Wordle`         | Which game type's board to return. Defaults to `Warmup`.                   |
| `seed=X` (repeatable) | Count only runs on these seeds. Omit for all seeds.                        |

One row per team, ranked by its best score. Ties go to whichever team got there first. `seeds` lists every seed seen for
the game type, most recently used first. The response is cached at the CDN for 2 seconds.

```json
{
  "game": "Wordle",
  "gameTypes": ["Warmup", "Wordle"],
  "leaderboard": [{
    "rank": 1, "team": "…", "score": 0.1, "costUsd": 32.97, "seed": "7", "id": "…",
    "bestAt": "…", "lastAt": "…", "runs": 4
  }],
  "seeds": [{ "seed": "7", "submissions": 12, "teams": 5, "lastAt": "…" }]
}
```

### Admin endpoints

These need an `x-admin-code: <ADMIN_CODE>` header.

| Request                          | Effect                                                      |
|----------------------------------|-------------------------------------------------------------|
| `GET /api/scores?all`            | Same as the public `GET` (accepts `game` and `seed`), plus every matching submission, newest first |
| `DELETE /api/scores?id=<id>`     | Delete one submission (the team's next-best run takes over) |
| `DELETE /api/scores?all`         | Clear everything: every game type and seed                  |

The board holds at most 10,000 submissions; after that, POSTs return `503` until an admin clears it.
