# Hackathon Leaderboard

A live leaderboard for the hackathon. Evaluation binaries POST a team name, score, and seed; the board shows each
team's best (lowest) score. An admin page, protected by an access code, can delete single submissions or clear the
board.

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
curl -X POST https://your-project.vercel.app/api/scores \
  -H 'content-type: application/json' \
  -d '{"team": "Team Rocket", "score": 0.1234, "seed": 42}'
```

| Field   | Type             | Rules                                                              |
|---------|------------------|--------------------------------------------------------------------|
| `team`  | string           | 1–64 characters. Case and extra whitespace are ignored for grouping. |
| `score` | number           | Finite. **Lower is better.**                                       |
| `seed`  | number or string | Required, up to 128 characters. Stored exactly, including 64-bit integers. |

Returns `201`:

```json
{
  "submission": { "id": "…", "team": "Team Rocket", "score": 0.1234, "seed": "42", "createdAt": "…" },
  "rank": 3,
  "best": { "score": 0.1234, "seed": "42" }
}
```

Errors return `4xx` with `{"error": "…"}`. See [`examples/submit.go`](examples/submit.go) for a Go client.

### `GET /api/scores`: leaderboard (open)

One row per team, ranked by its best score. Ties go to whichever team got there first. The response is cached at the
CDN for 2 seconds.

```json
{ "leaderboard": [{ "rank": 1, "team": "…", "score": 0.1, "seed": "7", "id": "…", "bestAt": "…", "lastAt": "…", "runs": 4 }] }
```

### Admin endpoints

These need an `x-admin-code: <ADMIN_CODE>` header.

| Request                          | Effect                                                      |
|----------------------------------|-------------------------------------------------------------|
| `GET /api/scores?all`            | Leaderboard plus every submission, newest first            |
| `DELETE /api/scores?id=<id>`     | Delete one submission (the team's next-best run takes over) |
| `DELETE /api/scores?all`         | Clear the leaderboard                                       |

The board holds at most 10,000 submissions; after that, POSTs return `503` until an admin clears it.
