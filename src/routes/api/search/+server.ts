import { json, error } from '@sveltejs/kit';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const COLS = { chapters: 'bible', verses: 'verses' } as const;

let q: QdrantClient | null = null;
async function client() {
	const url = env.QDRANT_URL;
	const key = env.QDRANT_KEY;
	if (!q) q = new QdrantClient({ url, apiKey: key, checkCompatibility: false });
	return q;
}

async function embed(text: string): Promise<number[]> {
	const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ model: 'qwen/qwen3-embedding-8b', input: text })
	});
	if (!r.ok) {
		const body = await r.text();
		throw error(502, `embed failed: ${r.status} ${body.slice(0, 200)}`);
	}
	const d = (await r.json()) as { data: { embedding: number[] }[] };
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
	if (b) f.must.push({ key: 'b', match: { value: b } });
	if (x != null && x !== '') f.must.push({ key: 'c', match: { value: Number(x) } });
	const hits = await (
		await client()
	).search(col, { vector: v, limit: 10, filter: f.must.length ? f : undefined });
	const r = hits.map((h) => ({
		b: h.payload?.b,
		c: h.payload?.c,
		v: h.payload?.v,
		t: h.payload?.t,
		s: h.score
	}));
	return json({ r });
};
