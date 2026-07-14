import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { get_balance } from '$lib/server/token_balance';
import type { SecretVal } from '$lib/server/qdrant';

type WF = { create(opts: { params: Record<string, unknown> }): Promise<{ id: string }> };
type AEnv = {
	DEEPRESEARCH_WF?: WF;
	VER_WORKFLOWS?: unknown;
	VER_WORKFLOWS_URL?: string;
	INTERNAL_TOKEN: string | { get(): Promise<string> };
	QDRANT_URL: SecretVal;
	QDRANT_KEY: SecretVal;
	MIN_START_KOBO?: string;
	MAX_PER_RESEARCH_KOBO?: string;
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const { q } = (await request.json().catch(() => ({}))) as { q?: string };
	console.log(`[api] POST /deepresearch q=${JSON.stringify(q ?? '').slice(0, 160)}`);
	if (!q?.trim()) {
		console.log(`[api] POST rejected: q required`);
		throw error(400, 'q required');
	}
	if (!locals.user?.id) return json({ error: 'Unauthorized' }, { status: 401 });
	const env = platform!.env as AEnv;
	const bal = await get_balance(env, locals.user.id);
	const min_start = Number(env.MIN_START_KOBO) || 10000;
	if (bal < min_start)
		return json({ error: 'insufficient tokens', balance: bal }, { status: 402 });
	const budget = Math.min(bal, Number(env.MAX_PER_RESEARCH_KOBO) || 200000);
	console.log(`[api] balance=${bal} budget=${budget}`);
	const l = crypto.randomUUID();
	const tok: string = typeof env.INTERNAL_TOKEN === 'string' ? env.INTERNAL_TOKEN : await env.INTERNAL_TOKEN.get();
	const auth = `Bearer ${tok}`;
	let id: string | undefined;
	let err: unknown;
	if (import.meta.env.DEV) {
		const url = `${env.VER_WORKFLOWS_URL}/create`;
		for (let a = 0; a < 3 && !id; a++) {
			console.log(`[api] create (remote) attempt ${a + 1}/3 log_id=${l}`);
			try {
				const r = await fetch(url, {
					method: 'POST',
					headers: { authorization: auth, 'content-type': 'application/json' },
					body: JSON.stringify({
						q: q.trim(),
						log_id: l,
						user_id: locals.user!.id,
						budget_kobo: budget
					})
				});
				if (!r.ok) throw new Error(`status ${r.status}: ${await r.text()}`);
				id = ((await r.json()) as { id: string }).id;
				console.log(`[api] created (remote) instance i=${id} l=${l}`);
			} catch (e) {
				err = e;
				console.error(`[api] create (remote) attempt ${a + 1} FAILED :: ${String(e)}`);
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
	} else {
		for (let a = 0; a < 3 && !id; a++) {
			console.log(`[api] create attempt ${a + 1}/3 log_id=${l}`);
			try {
				id = (
					await env.DEEPRESEARCH_WF.create({
						params: { q: q.trim(), log_id: l, user_id: locals.user!.id, budget_kobo: budget }
					})
				).id;
				console.log(`[api] created instance i=${id} l=${l}`);
			} catch (e) {
				err = e;
				console.error(`[api] create attempt ${a + 1} FAILED :: ${String(e)}`);
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
	}
	if (!id) {
		console.error(`[api] create exhausted retries :: ${String(err)}`);
		throw error(502, `failed to start workflow: ${String(err)}`);
	}
	return json({ i: id, l });
};

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform!.env as {
		VER_WORKFLOWS?: { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> };
		VER_WORKFLOWS_URL?: string;
		INTERNAL_TOKEN: string | { get(): Promise<string> };
	};
	const tok: string =
		typeof env.INTERNAL_TOKEN === 'string' ? env.INTERNAL_TOKEN : await env.INTERNAL_TOKEN.get();
	if (import.meta.env.DEV) {
		const r = await fetch(`${env.VER_WORKFLOWS_URL}/list`, {
			headers: { authorization: `Bearer ${tok}` }
		});
		console.log(`[api] GET /deepresearch (remote) status=${r.status}`);
		if (!r.ok) throw error(502, 'failed to list research');
		return json(await r.json());
	}
	const r = await env.VER_WORKFLOWS.fetch('https://ver-workflows/list', {
		headers: { authorization: `Bearer ${tok}` }
	});
	console.log(`[api] GET /deepresearch status=${r.status}`);
	if (!r.ok) throw error(502, 'failed to list research');
	return json(await r.json());
};
