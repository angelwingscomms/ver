import { type SecretVal, get_secret } from './qdrant';

export type ChatGptTokens = {
	accessToken: string;
	refreshToken?: string;
	idToken?: string;
	accountId?: string;
	expiresAt?: number;
};

export type ChatGptPending = {
	i: string;
	c: string;
	e: number;
};

function b64u(buf: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buf)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function ub64u(s: string): Uint8Array<ArrayBuffer> {
	s = s.replace(/-/g, '+').replace(/_/g, '/');
	while (s.length % 4) s += '=';
	const raw = atob(s);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

async function key_of(secret: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt_chatgpt_secret(secret: string, value: unknown): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await key_of(secret);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(JSON.stringify(value))
	);
	return `${b64u(iv.buffer)}.${b64u(ciphertext)}`;
}

export async function decrypt_chatgpt_secret<T>(secret: string, payload: string): Promise<T> {
	const [ivB64, ctB64] = payload.split('.');
	if (!ivB64 || !ctB64) throw new Error('malformed ciphertext');
	const key = await key_of(secret);
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: ub64u(ivB64) },
		key,
		ub64u(ctB64)
	);
	return JSON.parse(new TextDecoder().decode(plain)) as T;
}