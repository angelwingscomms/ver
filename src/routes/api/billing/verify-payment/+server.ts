import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { paystack_verify } from '$lib/paystack';
import { credit, get_balance } from '$lib/server/token_balance';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user?.id) throw error(401, 'Unauthorized');
	const body = (await request.json().catch(() => null)) as { reference?: string };
	const ref = body?.reference;
	if (!ref || typeof ref !== 'string')
		return json({ success: false, error: 'Missing reference' }, { status: 400 });
	try {
		const result = await paystack_verify(ref);
		if (result.status !== 'success')
			return json({ success: false, error: `Transaction ${result.status}` });
		await credit({ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY }, user.id, result.amount, ref);
		const bal = await get_balance(
			{ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY },
			user.id
		);
		return json({ success: true, balance: bal });
	} catch (e) {
		console.error('[verify-payment]', e);
		return json({ success: false, error: 'Verification failed' }, { status: 500 });
	}
};
