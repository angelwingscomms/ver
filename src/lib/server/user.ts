import type { User } from '$lib/types/user';
import { C, ZV, client, get_secret, type SecretVal } from './qdrant';
import { hash_pw, verify_pw } from './pw';

export type UEnv = { QDRANT_URL: SecretVal; QDRANT_KEY: SecretVal };

function pid(id: string): string {
	return 'u_' + id;
}

export async function save_user(
	env: UEnv,
	id: string,
	name: string,
	picture?: string,
	email?: string,
	provider: 'google' | 'local' = 'google'
): Promise<void> {
	const u: User = { s: 'u', n: name, p: picture, m: email, d: Date.now(), o: provider };
	const c = await get_user(env, id);
	if (c) {
		u.d = c.d;
		if (c.h) u.h = c.h;
		if (c.o) u.o = c.o;
	}
	try {
		await (
			await client(await get_secret(env.QDRANT_URL), await get_secret(env.QDRANT_KEY))
		).upsert(C, { points: [{ id: pid(id), vector: ZV, payload: u as unknown as Record<string, unknown> }] });
	} catch {
		/* best-effort */
	}
}

export async function get_user(env: UEnv, id: string): Promise<User | null> {
	try {
		const r = await (
			await client(await get_secret(env.QDRANT_URL), await get_secret(env.QDRANT_KEY))
		).retrieve(C, { ids: [pid(id)] });
		const u = r[0]?.payload as Record<string, unknown> | undefined;
		if (u?.s === 'u') {
			return {
				s: 'u',
				n: u.n as string,
				p: u.p as string | undefined,
				m: u.m as string | undefined,
				d: u.d as number,
				o: u.o as 'google' | 'local' | undefined,
				h: u.h as string | undefined
			};
		}
		return null;
	} catch {
		return null;
	}
}

export async function create_pw_user(env: UEnv, email: string, password: string): Promise<void> {
	const h = await hash_pw(password);
	await save_user(env, email, email, undefined, email, 'local');
	const c = await get_user(env, email);
	const u: User = { s: 'u', n: email, m: email, d: c?.d ?? Date.now(), o: 'local', h };
	try {
		await (
			await client(await get_secret(env.QDRANT_URL), await get_secret(env.QDRANT_KEY))
		).upsert(C, { points: [{ id: pid(email), vector: ZV, payload: u as unknown as Record<string, unknown> }] });
	} catch {
		/* best-effort */
	}
}

export async function verify_user_pw(env: UEnv, email: string, password: string): Promise<User | null> {
	const u = await get_user(env, email);
	if (!u || u.o !== 'local' || !u.h) return null;
	return (await verify_pw(password, u.h)) ? u : null;
}
