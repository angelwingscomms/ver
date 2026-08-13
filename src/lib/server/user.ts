import type { User } from '$lib/types/user';
import { C, ZV, client, get_secret, pt_id, type SecretVal } from './qdrant';
import { hash_pw, verify_pw } from './pw';

export type UEnv = { QDRANT_URL: SecretVal; QDRANT_KEY: SecretVal; LWC_KEY?: SecretVal };

async function cl(env: UEnv) {
	return client(await get_secret(env.QDRANT_URL), await get_secret(env.QDRANT_KEY));
}

async function write_user(env: UEnv, id: string, u: User): Promise<void> {
	const payload = { ...u } as Record<string, unknown>;
	for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
	await (
		await cl(env)
	).upsert(C, { wait: true, points: [{ id: await pt_id('u_' + id), vector: ZV, payload }] });
}

async function read_user(env: UEnv, id: string): Promise<User | null> {
	const r = await (await cl(env)).retrieve(C, { ids: [await pt_id('u_' + id)] });
	const u = r[0]?.payload as unknown as User | undefined;
	return u?.s === 'u' ? u : null;
}

export async function get_user(env: UEnv, id: string): Promise<User | null> {
	try {
		return await read_user(env, id);
	} catch {
		return null;
	}
}

export async function save_user(
	env: UEnv,
	id: string,
	name: string,
	picture?: string,
	email?: string,
	provider: NonNullable<User['o']> = 'google'
): Promise<void> {
	const c = await get_user(env, id);
	await write_user(env, id, {
		...c,
		s: 'u',
		n: name,
		p: picture ?? c?.p,
		m: email ?? c?.m,
		d: c?.d ?? Date.now(),
		o: c?.o ?? provider
	});
}

export async function create_pw_user(env: UEnv, email: string, password: string): Promise<boolean> {
	if (await get_user(env, email)) return false;
	await write_user(env, email, {
		s: 'u',
		n: email,
		m: email,
		d: Date.now(),
		o: 'local',
		h: await hash_pw(password)
	});
	return true;
}

export async function verify_user_pw(
	env: UEnv,
	email: string,
	password: string
): Promise<User | null> {
	const u = await get_user(env, email);
	if (!u || u.o !== 'local' || !u.h) return null;
	return (await verify_pw(password, u.h)) ? u : null;
}

export async function set_user_fields(
	env: UEnv,
	id: string,
	fields: Partial<Pick<User, 'cg' | 'cgn' | 'cgm' | 'cgl'>>
): Promise<void> {
	const c = await read_user(env, id);
	await write_user(env, id, { s: 'u', n: id, d: Date.now(), ...c, ...fields });
}
