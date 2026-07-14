import { env } from '$env/dynamic/private';

const SECRET = env.SECRET;

function b64(s: string): string {
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function ub64(s: string): string {
	s = s.replace(/-/g, '+').replace(/_/g, '/');
	while (s.length % 4) s += '=';
	return atob(s);
}

async function get_key(): Promise<CryptoKey> {
	const secret = new TextEncoder().encode(SECRET).slice(0, 32);
	return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
		'verify'
	]);
}

export async function encode_session(data: {
	id: string;
	name: string;
	picture?: string;
	email?: string;
}): Promise<string> {
	const p = { u: data.id, n: data.name, p: data.picture, m: data.email, e: Date.now() + 604800000 };
	const raw = b64(JSON.stringify(p));
	const k = await get_key();
	const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
	return raw + '.' + b64(String.fromCharCode(...new Uint8Array(sig)));
}

export async function decode_session(
	c: string | undefined | null
): Promise<{ user: { id: string; name: string; picture?: string; email?: string } } | null> {
	if (!c) return null;
	const [raw, sig] = c.split('.');
	if (!raw || !sig) return null;
	try {
		const k = await get_key();
		const sig_buf = Uint8Array.from(ub64(sig), (ch) => ch.charCodeAt(0)).buffer as ArrayBuffer;
		const valid = await crypto.subtle.verify('HMAC', k, sig_buf, new TextEncoder().encode(raw));
		if (!valid) return null;
		const p = JSON.parse(ub64(raw));
		if (p.e < Date.now()) return null;
		return { user: { id: p.u, name: p.n, picture: p.p, email: p.m } };
	} catch {
		return null;
	}
}
