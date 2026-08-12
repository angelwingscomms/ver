import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { start_chatgpt_login, CG_COOKIE, CG_COOKIE_MAX_AGE, type CgEnv } from '$lib/server/cg';

export const POST: RequestHandler = async ({ platform, cookies }) => {
	const env = platform!.env as CgEnv;
	try {
		const { pending, body } = await start_chatgpt_login(env);
		cookies.set(CG_COOKIE, pending, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: CG_COOKIE_MAX_AGE
		});
		return json(body);
	} catch (e) {
		throw error(502, `login failed: ${String((e as Error).message)}`);
	}
};
