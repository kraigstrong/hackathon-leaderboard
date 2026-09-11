import { HttpError } from './http.js';

// All submissions live in one Redis hash: id -> JSON-encoded submission.
const KEY = 'leaderboard:submissions';

// Talks to Upstash over its REST API, so there are no npm dependencies.
// The Vercel Marketplace integration sets KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
function upstashStore() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const command = async (...args) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) {
      throw new Error(`Upstash ${args[0]} failed (${res.status}): ${body?.error ?? 'unreadable response'}`);
    }
    return body.result;
  };

  return {
    async list() {
      const flat = (await command('HGETALL', KEY)) ?? [];
      const submissions = [];
      for (let i = 1; i < flat.length; i += 2) {
        try {
          submissions.push(JSON.parse(flat[i]));
        } catch {
          console.error(`Skipping unreadable submission ${flat[i - 1]}`);
        }
      }
      return submissions;
    },
    add: (submission) => command('HSET', KEY, submission.id, JSON.stringify(submission)),
    remove: async (id) => (await command('HDEL', KEY, id)) > 0,
    async clear() {
      const count = await command('HLEN', KEY);
      await command('DEL', KEY);
      return count;
    },
  };
}

// Local development only: data is lost on restart.
const memory = new Map();
const memoryStore = {
  list: async () => [...memory.values()].map((s) => ({ ...s })),
  add: async (submission) => void memory.set(submission.id, submission),
  remove: async (id) => memory.delete(id),
  async clear() {
    const count = memory.size;
    memory.clear();
    return count;
  },
};

export function getStore() {
  const store = upstashStore();
  if (store) return store;
  // Serverless instances don't share memory, so never silently fall back on Vercel.
  if (process.env.VERCEL) {
    throw new HttpError(503, 'Storage is not configured: connect an Upstash Redis database to this Vercel project');
  }
  return memoryStore;
}
