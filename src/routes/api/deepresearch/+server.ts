import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	const { q } = (await request.json().catch(() => ({}))) as { q?: string };
	if (!q?.trim()) throw error(400, 'q required');
	return json({ i: (await platform!.env.DEEPRESEARCH_WF.create({ params: { q: q.trim() } })).id });
};
