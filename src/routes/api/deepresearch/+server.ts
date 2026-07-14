import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { get_balance } from '$lib/server/token_balance';
import { wf_call, create_instance, type DrEnv } from '$lib/server/dr';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const { q } = (await request.json().catch(() => ({}))) as { q?: string };
	if (!q?.trim()) throw error(400, 'q required');
	if (!locals.user?.id) return json({ error: 'Unauthorized' }, { status: 401 });
	const env = platform!.env as DrEnv;
	const bal = await get_balance(env, locals.user.id);
	const min_start = Number(env.MIN_START_KOBO) || 10000;
	if (bal < min_start) return json({ error: 'insufficient tokens', balance: bal }, { status: 402 });
	const budget = Math.min(bal, Number(env.MAX_PER_RESEARCH_KOBO) || 200000);
	const l = crypto.randomUUID();
	let id: string;
	try {
		id = await create_instance(env, {
			q: q.trim(),
			log_id: l,
			user_id: locals.user!.id,
			budget_kobo: budget
		});
	} catch (e) {
		throw error(502, `failed to start workflow: ${String((e as Error).message)}`);
	}
	return json({ i: id, l });
};

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform!.env as DrEnv;
	const r = await wf_call(env, '/list');
	if (!r.ok) throw error(502, 'failed to list research');
	return json(await r.json());
};
