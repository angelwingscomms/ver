import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { get_balance } from '$lib/server/token_balance';
import { wf, create_instance, type DrEnv } from '$lib/server/dr';
import { FREE_SEARCHES } from '$lib/deepresearch/core';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const { q, n } = (await request.json().catch(() => ({}))) as { q?: string; n?: number };
	if (!q?.trim()) throw error(400, 'q required');
	if (!locals.user?.id) return json({ error: 'Unauthorized' }, { status: 401 });
	const env = platform!.env as DrEnv;
	const steps = Math.max(1, Math.floor(Number(n) || FREE_SEARCHES));
	const paid = steps > FREE_SEARCHES;
	let budget = 0;
	if (paid) {
		const bal = await get_balance(env, locals.user.id);
		const min_start = Number(env.MIN_START_KOBO) || 10000;
		if (bal < min_start)
			return json({ error: 'insufficient tokens', balance: bal }, { status: 402 });
		budget = Math.min(bal, Number(env.MAX_PER_RESEARCH_KOBO) || 200000);
	}
	const l = crypto.randomUUID();
	let id: string;
	try {
		id = await create_instance(env, {
			q: q.trim(),
			l,
			u: locals.user!.id,
			b: budget,
			n: steps
		});
	} catch (e) {
		throw error(502, `failed to start workflow: ${String((e as Error).message)}`);
	}
	return json({ i: id, l });
};

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform!.env as DrEnv;
	const r = await wf(env, '/list');
	if (!r.ok) throw error(502, 'failed to list research');
	return json(await r.json());
};
