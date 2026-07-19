import { Google, generateState, generateCodeVerifier } from 'arctic';
import { get_secret, type SecretVal } from './qdrant';

export type GoogleEnv = { GOOGLE_ID: SecretVal; GOOGLE_SECRET: SecretVal };

export async function google_client(origin: string, env: GoogleEnv): Promise<Google> {
	const id = await get_secret(env.GOOGLE_ID);
	const secret = await get_secret(env.GOOGLE_SECRET);
	return new Google(id, secret, new URL('/google', origin).toString());
}

export { generateState, generateCodeVerifier };
