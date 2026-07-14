import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify_webhook_sig } from '$lib/paystack';
import { credit } from '$lib/server/token_balance';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
	const sig = request.headers.get('x-paystack-signature');
	if (!sig) throw error(401, 'Missing signature');
	const raw = await request.text();
	if (!verify_webhook_sig(raw, sig)) throw error(401, 'Invalid signature');
	const event = JSON.parse(raw);
	if (event.event === 'charge.success') {
		const d = event.data;
		const ref = d.reference;
		const amount = d.amount;
		const meta = d.metadata || {};
		const user_id =
			typeof meta === 'object' && meta && typeof (meta as Record<string, unknown>).user_id === 'string'
				? (meta as Record<string, string>).user_id
				: d.customer?.email;
		if (!user_id) return json({ received: true });
		try {
			await credit(
				{ QDRANT_URL: env.QDRANT_URL, QDRANT_KEY: env.QDRANT_KEY },
				user_id,
				amount,
				ref
			);
		} catch (e) {
			console.error('[webhook] credit failed', e);
		}
	}
	return json({ received: true });
};
