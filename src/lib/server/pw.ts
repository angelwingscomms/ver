const ITER = 120_000;

function b64u(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(s: string): Uint8Array {
	s = s.replace(/-/g, '+').replace(/_/g, '/');
	while (s.length % 4) s += '=';
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export async function hash_pw(pw: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pw) as BufferSource,
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' },
		key,
		256
	);
	return `${b64u(salt)}.${b64u(bits)}`;
}

export async function verify_pw(pw: string, stored: string): Promise<boolean> {
	const [s, h] = stored.split('.');
	if (!s || !h) return false;
	const salt = unb64u(s);
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pw) as BufferSource,
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' },
		key,
		256
	);
	return b64u(bits) === h;
}
