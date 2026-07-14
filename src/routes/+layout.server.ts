import type { LayoutServerLoad } from './$types';
import { get_balance } from '$lib/server/token_balance';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user ?? null;
	let balance = 0;
	if (user) {
		balance = await get_balance(
			{ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY },
			user.id
		);
	}
	return { user, balance };
};
