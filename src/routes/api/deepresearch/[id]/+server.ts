import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { status_instance, type DrEnv } from '$lib/server/dr';

export const GET: RequestHandler = async ({ params, url, platform }) => {
	const l = url.searchParams.get('l') ?? '';
	const env = platform!.env as DrEnv;
	const r = await status_instance(env, params.id, l);
	if (r.status === 404) throw error(404, 'not found');
	return json(await r.json());
};
