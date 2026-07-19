import { C, ZV, client, get_secret, type SecretVal } from './qdrant';

export type TBEnv = { QDRANT_URL: SecretVal; QDRANT_KEY: SecretVal };

const DAILY_AMOUNT = 5400;
const DAY_S = 86400;
let q_url = '';
let q_key = '';

async function sha1_hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function id_to_uuid(s: string): Promise<string> {
	const h = await sha1_hex(s);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function cl(env: TBEnv) {
	if (!q_url || !q_key) {
		q_url = await get_secret(env.QDRANT_URL);
		q_key = await get_secret(env.QDRANT_KEY);
	}
	return client(q_url, q_key);
}

async function read_user(env: TBEnv, user_id: string): Promise<{ bal: number; daily: number }> {
	const pid = await id_to_uuid(user_id);
	const r = await (await cl(env)).retrieve(C, { ids: [pid] });
	const p = r[0]?.payload;
	return { bal: (p?.t as number) || 0, daily: (p?.d as number) || 0 };
}

async function write_user(env: TBEnv, user_id: string, bal: number, daily: number): Promise<void> {
	const pid = await id_to_uuid(user_id);
	try {
		await (await cl(env)).upsert(C, {
			points: [{ id: pid, vector: ZV, payload: { t: bal, u: user_id, d: daily } }]
		});
	} catch {
		/* best-effort */
	}
}

export async function maybe_daily_credit(env: TBEnv, user_id: string): Promise<number> {
	const { bal, daily } = await read_user(env, user_id);
	const now = Math.floor(Date.now() / 1000);
	if (now - daily >= DAY_S) {
		const n = bal + DAILY_AMOUNT;
		await write_user(env, user_id, n, now);
		return n;
	}
	return bal;
}

export async function get_balance(env: TBEnv, user_id: string): Promise<number> {
	return maybe_daily_credit(env, user_id);
}

async function is_used(env: TBEnv, ref: string): Promise<boolean> {
	const pid = `r_${ref}`;
	try {
		const r = await (await cl(env)).retrieve(C, { ids: [pid] });
		return r[0]?.payload?.s === 'r';
	} catch {
		return false;
	}
}

async function mark_used(env: TBEnv, ref: string, user_id: string, amount: number): Promise<void> {
	const pid = `r_${ref}`;
	try {
		await (await cl(env)).upsert(C, {
			points: [{ id: pid, vector: ZV, payload: { s: 'r', u: user_id, a: amount, d: Date.now() } }]
		});
	} catch {
		/* best-effort */
	}
}

export async function credit(env: TBEnv, user_id: string, amount_kobo: number, ref?: string): Promise<number> {
	if (ref && (await is_used(env, ref))) return (await read_user(env, user_id)).bal;
	const t = Math.floor(amount_kobo);
	const { bal, daily } = await read_user(env, user_id);
	const n = bal + t;
	await write_user(env, user_id, n, daily);
	if (ref) await mark_used(env, ref, user_id, t);
	return n;
}

export async function deduct(env: TBEnv, user_id: string, amount: number): Promise<number> {
	const cur = await maybe_daily_credit(env, user_id);
	const n = Math.max(0, cur - amount);
	await write_user(env, user_id, n, (await read_user(env, user_id)).daily);
	return n;
}
