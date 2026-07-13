import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, platform }) => {
	const l = url.searchParams.get('l') ?? '';
	console.log(`[api] GET /deepresearch/${params.id} l=${l || '(none)'}`);
	const env = platform!.env as {
		DEEPRESEARCH_WF?: any;
		VER_WORKFLOWS?: any;
		VER_WORKFLOWS_URL?: string;
		INTERNAL_TOKEN: any;
	};
	if (import.meta.env.DEV) {
		const tok: string =
			typeof env.INTERNAL_TOKEN === 'string' ? env.INTERNAL_TOKEN : await env.INTERNAL_TOKEN.get();
		const r = await fetch(`${env.VER_WORKFLOWS_URL}/status/${params.id}?l=${encodeURIComponent(l)}`, {
			headers: { authorization: `Bearer ${tok}` }
		});
		console.log(`[api] GET (remote) status=${r.status}`);
		if (r.status === 404) {
			console.log(`[api] GET (remote) 404: instance not found ${params.id}`);
			throw error(404, 'not found');
		}
		return json(await r.json());
	}
	let inst;
	try {
		inst = await env.DEEPRESEARCH_WF.get(params.id);
	} catch {
		console.log(`[api] GET 404: instance not found ${params.id}`);
		throw error(404, 'not found');
	}
	const st = await inst.status();
	let t: unknown[] = [];
	if (l) {
		try {
			const tok: string =
				typeof env.INTERNAL_TOKEN === 'string' ? env.INTERNAL_TOKEN : await env.INTERNAL_TOKEN.get();
			const r = await env.VER_WORKFLOWS.fetch(`https://ver-workflows/thoughts/${l}`, {
				headers: { authorization: `Bearer ${tok}` }
			});
			console.log(`[api] thoughts fetch status=${r.status}`);
			if (r.ok) t = (await r.json() as { t: unknown[] }).t;
		} catch (e) {
			console.error(`[api] thoughts fetch FAILED :: ${String(e)}`);
		}
	}
	console.log(`[api] GET ${params.id} :: status=${st.status} thoughts=${t.length}`);
	return json({ s: st.status, o: st.output ?? null, e: st.error ?? null, t });
};
