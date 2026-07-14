import { google_client } from '$lib/server/oauth';
import { encode_session } from '$lib/server/session';
import { save_user } from '$lib/server/user';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function GET(event: RequestEvent): Promise<Response> {
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	const stored_state = event.cookies.get('oauth_state') ?? null;
	const stored_verifier = event.cookies.get('oauth_verifier') ?? null;
	if (!code || !state || !stored_state || !stored_verifier || state !== stored_state)
		return new Response(null, { status: 400 });
	let tokens: { accessToken(): string };
	try {
		tokens = await google_client(event.url.origin).validateAuthorizationCode(code, stored_verifier);
	} catch {
		return new Response(null, { status: 400 });
	}
	const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
		headers: { Authorization: `Bearer ${tokens.accessToken()}` }
	});
	if (!ures.ok) return new Response(null, { status: 400 });
	const guser = (await ures.json()) as { sub: string; name: string; picture?: string; email?: string };
	await save_user(
		{ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY },
		guser.sub,
		guser.name,
		guser.picture,
		guser.email,
		'google'
	);
	const session = await encode_session({
		id: guser.sub,
		name: guser.name,
		picture: guser.picture,
		email: guser.email
	});
	event.cookies.set('session', session, { path: '/', httpOnly: true, maxAge: 604800, sameSite: 'lax' });
	event.cookies.delete('oauth_state', { path: '/' });
	event.cookies.delete('oauth_verifier', { path: '/' });
	return new Response(null, { status: 302, headers: { Location: '/deepresearch' } });
}
