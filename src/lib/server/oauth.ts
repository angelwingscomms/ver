import { Google, generateState, generateCodeVerifier } from 'arctic';
import { env } from '$env/dynamic/private';

export function google_client(origin: string): Google {
	return new Google(env.GOOGLE_ID!, env.GOOGLE_SECRET!, new URL('/google', origin).toString());
}

export { generateState, generateCodeVerifier };
