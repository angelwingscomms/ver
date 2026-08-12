import {
	resolveConfig,
	requestDeviceCode,
	pollDeviceCode,
	exchangeDeviceAuthorization,
	parseUser,
	listCodexModels
} from '@opencoredev/loginwithchatgpt-core';
import { get_user, set_user_fields, type UEnv } from './user';
import {
	encrypt_chatgpt_secret,
	decrypt_chatgpt_secret,
	type ChatGptPending,
	type ChatGptTokens
} from './cg_crypto';
import type { SecretVal } from './qdrant';

export type CgEnv = {
	QDRANT_URL: SecretVal;
	QDRANT_KEY: SecretVal;
	LWC_KEY?: SecretVal;
};

async function key_of(env: CgEnv): Promise<string> {
	const v = env.LWC_KEY;
	return v && typeof (v as { get?: unknown }).get === 'function'
		? await (v as { get: () => Promise<string> }).get()
		: ((v as string) ?? '');
}

export async function start_chatgpt_login(env: CgEnv, userId: string) {
	const config = resolveConfig();
	const device = await requestDeviceCode(config);
	const pending: ChatGptPending = { i: device.deviceAuthId, c: device.userCode, e: device.expiresAt };
	await set_user_fields(env as UEnv, userId, {
		cgp: await encrypt_chatgpt_secret(await key_of(env), pending)
	});
	return {
		user_code: device.userCode,
		verification_url: device.verificationUrl,
		interval: device.interval,
		expires_at: device.expiresAt
	};
}

export async function poll_chatgpt_login(env: CgEnv, userId: string) {
	const u = await get_user(env as UEnv, userId);
	if (!u?.cgp) return { status: 'pending' };
	const pending = await decrypt_chatgpt_secret<ChatGptPending>(await key_of(env), u.cgp);
	if (Date.now() > pending.e) {
		await set_user_fields(env as UEnv, userId, { cgp: undefined });
		return { status: 'expired' };
	}
	const config = resolveConfig();
	const poll = await pollDeviceCode(config, {
		deviceAuthId: pending.i,
		userCode: pending.c
	});
	if (poll.status === 'pending') return { status: 'pending' };
	const tokens = await exchangeDeviceAuthorization(config, poll);
	const profile = parseUser(tokens.idToken);
	const models = await listCodexModels({
		config,
		getAuth: () => ({ accessToken: tokens.accessToken, accountId: tokens.accountId! })
	}).catch(() => []);
	await set_user_fields(env as UEnv, userId, {
		cg: await encrypt_chatgpt_secret(await key_of(env), tokens),
		cgp: undefined,
		cgn: profile?.name,
		cgm: profile?.email,
		cgl: models
	});
	return {
		status: 'authenticated',
		n: profile?.name,
		m: profile?.email,
		models
	};
}

export async function chatgpt_status(env: CgEnv, userId: string) {
	const u = await get_user(env as UEnv, userId);
	return {
		connected: !!u?.cg,
		n: u?.cgn,
		m: u?.cgm,
		models: u?.cgl ?? []
	};
}

export async function disconnect_chatgpt(env: CgEnv, userId: string) {
	await set_user_fields(env as UEnv, userId, {
		cg: undefined,
		cgp: undefined,
		cgn: undefined,
		cgm: undefined,
		cgl: undefined
	});
}

export type ChatGptSession = ChatGptTokens;