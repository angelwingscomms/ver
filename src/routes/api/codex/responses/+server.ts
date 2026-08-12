import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { codex_call, type CgEnv } from '$lib/server/cg';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user?.id) throw error(401, 'unauthorized');
	const env = platform!.env as CgEnv;
	let r: Response;
	try {
		r = await codex_call(env, locals.user.id, await request.text());
	} catch (e) {
		throw error(502, `codex call failed: ${String((e as Error).message)}`);
	}
	return new Response(r.body, {
		status: r.status,
		headers: {
			'content-type': r.headers.get('content-type') ?? 'application/json',
			'cache-control': 'no-store'
		}
	});
};
