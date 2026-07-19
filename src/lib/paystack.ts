import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { createHmac } from 'node:crypto';

const BASE = 'https://api.paystack.co';

export interface PaystackInitResult {
	authorization_url: string;
	access_code: string;
	reference: string;
}

export interface PaystackVerifyResult {
	status: string;
	reference: string;
	amount: number;
	customer: { email: string };
	metadata: Record<string, unknown>;
}

export function get_secret_key(): string {
	const is_test = env.PAYSTACK_TEST !== undefined ? env.PAYSTACK_TEST === '.' : dev;
	return (is_test ? env.PAYSTACK_SECRET_KEY_TEST : env.PAYSTACK_SECRET_KEY_LIVE) || env.PAYSTACK_SECRET_KEY || '';
}

export async function paystack_init(
	email: string,
	amount_kobo: number,
	reference: string,
	callback_url: string,
	metadata?: Record<string, unknown>
): Promise<PaystackInitResult> {
	const secret_key = get_secret_key();
	const res = await fetch(`${BASE}/transaction/initialize`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${secret_key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email,
			amount: amount_kobo,
			reference,
			callback_url,
			metadata: metadata ? JSON.stringify(metadata) : undefined
		})
	});
	if (!res.ok) throw new Error(`Paystack init failed: ${await res.text()}`);
	const body = (await res.json()) as { status: boolean; message?: string; data: PaystackInitResult };
	if (!body.status) throw new Error(`Paystack init error: ${body.message}`);
	return body.data;
}

export async function paystack_verify(reference: string): Promise<PaystackVerifyResult> {
	const secret_key = get_secret_key();
	const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
		headers: { Authorization: `Bearer ${secret_key}`, 'Content-Type': 'application/json' }
	});
	if (!res.ok) throw new Error(`Paystack verify failed: ${await res.text()}`);
	const body = (await res.json()) as { status: boolean; message?: string; data: PaystackVerifyResult };
	if (!body.status) throw new Error(`Paystack verify error: ${body.message}`);
	return body.data;
}

export function verify_webhook_sig(raw_body: string, signature: string): boolean {
	const secret_key = get_secret_key();
	if (!secret_key) return false;
	const hash = createHmac('sha512', secret_key).update(raw_body).digest('hex');
	return hash === signature;
}
