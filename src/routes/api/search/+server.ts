import { json, error } from '@sveltejs/kit';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '$env/dynamic/private';
import { BOOKS } from '$lib/books';
import type { RequestHandler } from './$types';

const COLS = { chapters: 'bible', verses: 'verses' } as const;

type SecretVal = string | { get?: () => Promise<string> } | undefined;
async function get_secret(v: SecretVal): Promise<string> {
	if (v && typeof (v as { get?: unknown }).get === 'function')
		return await (v as { get: () => Promise<string> }).get();
	return (v as string) ?? '';
}

let q: QdrantClient | null = null;
async function client() {
	if (!q) {
		const url = await get_secret(env.QDRANT_URL);
		const key = await get_secret(env.QDRANT_KEY);
		q = new QdrantClient({ url, apiKey: key, checkCompatibility: false });
	}
	return q;
}

async function embed(text: string): Promise<number[]> {
	const key = await get_secret(env.OPENROUTER_KEY);
	console.error('[embed] calling openrouter for', text.slice(0, 80));
	console.error('[embed] key:', `${key.slice(0, 8)}…(${key.length} chars)`);
	let r: Response;
	try {
		r = await fetch('https://openrouter.ai/api/v1/embeddings', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ model: 'qwen/qwen3-embedding-8b', input: text })
		});
	} catch (e: unknown) {
		const err = e instanceof Error ? e : new Error(String(e));
		const cause = err.cause as unknown;
		console.error('[embed] fetch threw:', err.name, err.message);
		console.error('[embed] cause:', JSON.stringify(cause, Object.getOwnPropertyNames(cause ?? {})));
		console.error('[embed] stack:', err.stack);
		console.error('[embed] env OPENROUTER_KEY set:', !!key, 'len:', key.length);
		const msg = `${err.name}: ${err.message} cause=${JSON.stringify(cause)}`;
		throw error(502, `embed fetch failed: ${msg}`);
	}
	console.error('[embed] status:', r.status);
	if (!r.ok) {
		const body = await r.text();
		console.error('[embed] non-ok body:', body.slice(0, 300));
		throw error(502, `embed failed: ${r.status} ${body.slice(0, 200)}`);
	}
	const d = (await r.json()) as { data: { embedding: number[] }[] };
	console.error('[embed] ok, embedding length:', d.data[0].embedding.length);
	return d.data[0].embedding;
}

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q');
	const b = url.searchParams.get('b');
	const x = url.searchParams.get('x');
	const has_c = url.searchParams.has('c');
	const has_v = url.searchParams.has('v');
	if (has_c && has_v)
		throw error(400, 'ambiguous scope: pass exactly one of ?c (chapters) or ?v (verses), not both');
	const col = has_c ? COLS.chapters : COLS.verses;
	if (!query || !query.trim()) throw error(400, 'q required');
	const v = await embed(query);
	const f = { must: [] as any[] };
	if (b) f.must.push({ key: 'b', match: { value: Number(b) } });
	if (x != null && x !== '') f.must.push({ key: 'c', match: { value: Number(x) } });
	console.error('[search] querying qdrant col=%s filter=%j', col, f);
	let hits;
	try {
		hits = await (
			await client()
		).search(col, { vector: v, limit: 10, filter: f.must.length ? f : undefined });
	} catch (e: unknown) {
		const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
		console.error('[search] qdrant threw:', msg);
		throw error(502, `qdrant search failed: ${msg}`);
	}
	console.error('[search] qdrant returned %d hits', hits.length);
	const r = hits.map((h) => ({
		b: BOOKS[(Number(h.payload?.b) || 1) - 1] ?? h.payload?.b,
		c: h.payload?.c,
		v: h.payload?.v,
		t: h.payload?.t,
		s: h.score
	}));
	return json({ r });
};
