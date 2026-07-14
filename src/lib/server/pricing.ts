export type ModelPrice = { i: number; o: number; ic: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
	'deepseek/deepseek-v4-flash': { i: 0.09, o: 0.18, ic: 0.018 }
};

export function calc_cost(
	model: string,
	pin: number,
	pout: number,
	pcache = 0
): number {
	const p = MODEL_PRICES[model] ?? MODEL_PRICES['deepseek/deepseek-v4-flash'];
	return (pin / 1e6) * p.i + (pout / 1e6) * p.o + (pcache / 1e6) * p.ic;
}

export function kobo(usd: number, token_rate: number, ngn_usd: number): number {
	return Math.round(usd * ngn_usd * 100 * token_rate);
}
