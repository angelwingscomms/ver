import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { wf_call, type DrEnv } from '$lib/server/dr';

export const GET: RequestHandler = async ({ params, url, platform }) => {
	const l = url.searchParams.get('l') ?? '';
	const env = platform!.env as DrEnv;
	if (import.meta.env.DEV) {
		const r = await wf_call(env, `/status/${params.id}?l=${encodeURIComponent(l)}`);
		if (r.status === 404) throw error(404, 'not found');
		return json(await r.json());
	}
	let inst;
	try {
		inst = await env.DEEPRESEARCH_WF!.get(params.id);
	} catch {
		throw error(404, 'not found');
	}
	const st = await inst.status();
	let t: unknown[] = [];
	if (l) {
		try {
			const r = await wf_call(env, `/thoughts/${l}`);
			if (r.ok) t = ((await r.json()) as { t: unknown[] }).t;
		} catch {
			/* thoughts best-effort */
		}
	}
	return json({ s: st.status, o: st.output ?? null, e: st.error ?? null, t });
};
