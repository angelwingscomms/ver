import { json, error } from '@sveltejs/kit';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const COL = 'bible';
let q: QdrantClient | null = null;
function client() {
	if (!q) q = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_KEY, checkCompatibility: false });
	return q;
}

async function embed(text: string): Promise<number[]> {
	const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: 'qwen/qwen3-embedding-8b', input: text })
	});
	if (!r.ok) {
		const body = await r.text();
		throw error(502, `embed failed: ${r.status} ${body.slice(0, 200)}`);
	}
	const d = (await r.json()) as { data: { embedding: number[] }[] };
	return d.data[0].embedding;
}

export const POST: RequestHandler = async ({ request }) => {
	const { q: query, b, c } = (await request.json()) as { q?: unknown; b?: string; c?: number };
	if (!query || typeof query !== 'string') throw error(400, 'q required');
	const v = await embed(query);
	const f = { must: [] as any[] };
	if (b) f.must.push({ key: 'b', match: { value: b } });
	if (typeof c === 'number') f.must.push({ key: 'c', match: { value: c } });
	const hits = await client().search(COL, { vector: v, limit: 10, filter: f.must.length ? f : undefined });
	const r = hits.map((h) => ({
		b: h.payload?.b,
		c: h.payload?.c,
		t: h.payload?.t,
		s: h.score
	}));
	return json({ r });
};
