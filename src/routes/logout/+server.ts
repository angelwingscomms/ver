import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete('session', { path: '/' });
	return json({ ok: true });
};

export const GET: RequestHandler = async ({ cookies }) => {
	cookies.delete('session', { path: '/' });
	return new Response(null, { status: 302, headers: { Location: '/' } });
};
