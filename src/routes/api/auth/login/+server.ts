import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify_user_pw } from '$lib/server/user';
import { encode_session } from '$lib/server/session';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => null)) as { e?: string; p?: string };
	const e = body?.e?.trim().toLowerCase();
	const p = body?.p ?? '';
	if (!e || !p) throw error(400, 'email and password required');
	const u = await verify_user_pw({ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY }, e, p);
	if (!u) throw error(401, 'invalid credentials');
	const session = await encode_session({ id: e, name: u.n, picture: u.p, email: u.m });
	cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
	return json({ ok: true });
};
