import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { start_chatgpt_login, type CgEnv } from '$lib/server/cg';

export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.id) throw error(401, 'unauthorized');
	const env = platform!.env as CgEnv;
	try {
		return json(await start_chatgpt_login(env, locals.user.id));
	} catch (e) {
		throw error(502, `login failed: ${String((e as Error).message)}`);
	}
};