import {
	resolveConfig,
	requestDeviceCode,
	pollDeviceCode,
	exchangeDeviceAuthorization,
	parseUser,
	listCodexModels,
	ensureFreshTokens,
	createCodexFetch
} from '@opencoredev/loginwithchatgpt-core';
import { get_user, save_user, set_user_fields, type UEnv } from './user';
import {
	encrypt_chatgpt_secret,
	decrypt_chatgpt_secret,
	type ChatGptPending,
	type ChatGptTokens
} from './cg_crypto';
import { get_secret } from './qdrant';

export type CgEnv = UEnv;

export const CG_COOKIE = 'cg_pending';
export const CG_COOKIE_MAX_AGE = 900;

export type CgPoll =
	| { status: 'pending' }
	| { status: 'expired' }
	| { status: 'authenticated'; id: string; n?: string; m?: string; models: string[] };

export async function start_chatgpt_login(env: CgEnv) {
	const device = await requestDeviceCode(resolveConfig());
	const pending: ChatGptPending = {
		i: device.deviceAuthId,
		c: device.userCode,
		e: device.expiresAt
	};
	return {
		pending: await encrypt_chatgpt_secret(await get_secret(env.LWC_KEY), pending),
		body: {
			user_code: device.userCode,
			verification_url: device.verificationUrl,
			interval: device.interval,
			expires_at: device.expiresAt
		}
	};
}

export async function poll_chatgpt_login(
	env: CgEnv,
	cookie: string | undefined,
	user_id?: string
): Promise<CgPoll> {
	if (!cookie) return { status: 'expired' };
	const key = await get_secret(env.LWC_KEY);
	let pending: ChatGptPending;
	try {
		pending = await decrypt_chatgpt_secret<ChatGptPending>(key, cookie);
	} catch {
		return { status: 'expired' };
	}
	if (Date.now() > pending.e) return { status: 'expired' };

	const config = resolveConfig();
	const poll = await pollDeviceCode(config, { deviceAuthId: pending.i, userCode: pending.c });
	if (poll.status === 'pending') return { status: 'pending' };

	const tokens = await exchangeDeviceAuthorization(config, poll);
	const profile = parseUser(tokens.idToken);
	const id = user_id ?? profile?.email ?? profile?.accountId;
	if (!id) throw new Error('chatgpt account returned no email or account id');

	const models = tokens.accountId
		? await listCodexModels({
				config,
				getAuth: () => ({ accessToken: tokens.accessToken, accountId: tokens.accountId! })
			}).catch(() => [])
		: [];

	if (!user_id) await save_user(env, id, profile?.name ?? id, undefined, profile?.email, 'chatgpt');
	await set_user_fields(env, id, {
		cg: await encrypt_chatgpt_secret(key, tokens),
		cgn: profile?.name,
		cgm: profile?.email,
		cgl: models
	});
	return { status: 'authenticated', id, n: profile?.name, m: profile?.email, models };
}

export async function chatgpt_status(env: CgEnv, userId: string) {
	const u = await get_user(env, userId);
	return { connected: !!u?.cg, n: u?.cgn, m: u?.cgm, models: u?.cgl ?? [] };
}

export async function codex_call(env: CgEnv, userId: string, body: string): Promise<Response> {
	const u = await get_user(env, userId);
	if (!u?.cg) throw new Error('no chatgpt account connected');
	const key = await get_secret(env.LWC_KEY);
	let tokens = await decrypt_chatgpt_secret<ChatGptTokens>(key, u.cg);
	const config = resolveConfig();
	const codex_fetch = createCodexFetch({
		config,
		getAuth: async () => {
			tokens = await ensureFreshTokens(config, tokens, {
				onRefresh: async (t) => {
					tokens = t;
					await set_user_fields(env, userId, { cg: await encrypt_chatgpt_secret(key, t) });
				}
			});
			return { accessToken: tokens.accessToken, accountId: tokens.accountId! };
		}
	});
	return codex_fetch(`${config.codexBaseUrl}/responses`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});
}

export async function disconnect_chatgpt(env: CgEnv, userId: string) {
	await set_user_fields(env, userId, {
		cg: undefined,
		cgn: undefined,
		cgm: undefined,
		cgl: undefined
	});
}

export type ChatGptSession = ChatGptTokens;
