import { QdrantClient } from '@qdrant/js-client-rest';

export type SecretVal = string | { get?: () => Promise<string> } | undefined;

export async function get_secret(v: SecretVal): Promise<string> {
	if (v && typeof (v as { get?: unknown }).get === 'function')
		return await (v as { get: () => Promise<string> }).get();
	return (v as string) ?? '';
}

let q: QdrantClient | null = null;
let q_url = '';
let q_key = '';

export async function client(url: string, key: string): Promise<QdrantClient> {
	if (!q || q_url !== url || q_key !== key)
		q = new QdrantClient({ url, apiKey: key, checkCompatibility: false });
	q_url = url;
	q_key = key;
	return q;
}

export const ZV: Record<string, number[]> = {};
export const C = 'i';

export async function pt_id(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
	const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
