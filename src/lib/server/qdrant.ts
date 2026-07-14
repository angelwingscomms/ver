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

export const ZV: number[] = new Array(3072).fill(0);
export const C = 'i';
