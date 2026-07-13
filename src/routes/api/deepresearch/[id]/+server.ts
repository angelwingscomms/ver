import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
	let inst;
	try {
		inst = await platform!.env.DEEPRESEARCH_WF.get(params.id);
	} catch {
		throw error(404, 'not found');
	}
	const st = await inst.status();
	return json({ s: st.status, o: st.output ?? null, e: st.error ?? null });
};
