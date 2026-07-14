import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { get_balance } from '$lib/server/token_balance';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.id) return json({ balance: 0 });
	const bal = await get_balance(
		{ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY },
		locals.user.id
	);
	return json({ balance: bal });
};
