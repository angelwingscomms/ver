import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { chatgpt_status, type CgEnv } from '$lib/server/cg';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.id) throw error(401, 'unauthorized');
	const env = platform!.env as CgEnv;
	return json(await chatgpt_status(env, locals.user.id));
};