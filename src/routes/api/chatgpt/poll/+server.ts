import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { poll_chatgpt_login, CG_COOKIE, type CgEnv } from '$lib/server/cg';
import { encode_session } from '$lib/server/session';

export const POST: RequestHandler = async ({ platform, cookies, locals }) => {
	const env = platform!.env as CgEnv;
	const signed_in = !!locals.user?.id;
	let r;
	try {
		r = await poll_chatgpt_login(env, cookies.get(CG_COOKIE), locals.user?.id);
	} catch (e) {
		cookies.delete(CG_COOKIE, { path: '/' });
		throw error(502, `poll failed: ${String((e as Error).message)}`);
	}
	if (r.status === 'pending') return json(r);

	cookies.delete(CG_COOKIE, { path: '/' });
	if (r.status === 'expired') return json(r);

	if (!signed_in) {
		cookies.set('session', await encode_session({ id: r.id, name: r.n ?? r.id, email: r.m }), {
			path: '/',
			httpOnly: true,
			maxAge: 604800,
			sameSite: 'lax'
		});
	}
	return json({
		status: r.status,
		n: r.n,
		m: r.m,
		models: r.models,
		r: signed_in ? null : '/deepresearch'
	});
};
