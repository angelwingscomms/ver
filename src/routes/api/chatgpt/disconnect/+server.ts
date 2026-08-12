import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disconnect_chatgpt, type CgEnv } from '$lib/server/cg';

export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.id) throw error(401, 'unauthorized');
	const env = platform!.env as CgEnv;
	await disconnect_chatgpt(env, locals.user.id);
	return json({ ok: true });
};
