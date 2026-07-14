import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type DurableObjectState,
	type DurableObjectNamespace
} from 'cloudflare:workers';
import {
	MAX_TURNS,
	SYSTEM_PROMPT,
	MODEL,
	call_llm,
	search_bible,
	type Msg
} from '../../src/lib/deepresearch/core';
import { calc_cost, kobo } from '../../src/lib/server/pricing';
import { deduct, get_balance } from '../../src/lib/server/token_balance';

type T = { step: string; k: string; n: number; c: string };
type E = {
	OPENROUTER_KEY: { get(): Promise<string> };
	QDRANT_URL: { get(): Promise<string> };
	QDRANT_KEY: { get(): Promise<string> };
	TOKEN_RATE?: string;
	NGN_USD?: string;
	DR_LOG: DurableObjectNamespace;
	DR_INDEX: DurableObjectNamespace;
	INTERNAL_TOKEN: string;
};

type R = { i: string; q: string; l: string; c: number };
type P = { q: string; log_id: string; user_id: string; budget_kobo: number };

async function check_auth(req: Request, env: E): Promise<Response | null> {
	if (req.headers.get('authorization') !== `Bearer ${env.INTERNAL_TOKEN}`)
		return new Response('unauthorized', { status: 401 });
	return null;
}

const RETRY = {
	retries: { limit: 9, delay: '30 seconds', backoff: 'exponential' },
	timeout: '10 minutes'
} as const;

function thoughts_from_msg(m: Msg, t: number): { k: string; c: string }[] {
	const out: { k: string; c: string }[] = [];
	if (m.content) out.push({ k: 'think', c: m.content });
	for (const tc of m.tool_calls ?? []) {
		if (tc.function.name === 'search_bible') {
			let q = '';
			try {
				q = String(JSON.parse(tc.function.arguments || '{}').query ?? '');
			} catch {
				q = '';
			}
			out.push({ k: 'search', c: q ? `Searching scripture: “${q}”` : 'Searching scripture…' });
		} else if (tc.function.name === 'finish') {
			out.push({ k: 'finish', c: 'Synthesizing final answer…' });
		}
	}
	if (!out.length) out.push({ k: 'think', c: '(thinking…)' });
	return out;
}

async function log_think(env: E, log_id: string, step: string, k: string, n: number, c: string) {
	console.log(`[dr] log_think -> ${step} k=${k} c=${JSON.stringify(c).slice(0, 160)}`);
	const id = env.DR_LOG.idFromName(log_id);
	try {
		await env.DR_LOG.get(id).fetch('https://do/append', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ step, k, n, c } satisfies T)
		});
	} catch (e) {
		console.error(`[dr] log_think FAILED step=${step} :: ${String(e)}`);
	}
}

export class DrLog {
	constructor(private state: DurableObjectState) {}
	async fetch(req: Request): Promise<Response> {
		const u = new URL(req.url);
		if (req.method === 'POST' && u.pathname === '/append') {
			const t = (await req.json()) as T;
			console.log(`[dr-log] append ${t.step} k=${t.k} n=${t.n}`);
			const all = ((await this.state.storage.get('t')) ?? []) as T[];
			const i = all.findIndex((x) => x.step === t.step);
			if (i >= 0) all[i] = t;
			else all.push(t);
			await this.state.storage.put('t', all);
			return new Response('ok');
		}
		if (u.pathname === '/thoughts') {
			const all = ((await this.state.storage.get('t')) ?? []) as T[];
			console.log(`[dr-log] thoughts read (${all.length})`);
			return new Response(JSON.stringify({ t: all }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		console.log(`[dr-log] unknown path ${req.method} ${u.pathname}`);
		return new Response('not found', { status: 404 });
	}
}

export class DeepResearchWorkflow extends WorkflowEntrypoint<E, P> {
	async run(event: WorkflowEvent<P>, step: WorkflowStep) {
		const q = event.payload.q;
		const log_id = event.payload.log_id;
		const user_id = event.payload.user_id;
		const budget_kobo = event.payload.budget_kobo;
		console.log(
			`[dr] run start :: log_id=${log_id} user=${user_id} budget=${budget_kobo} q=${JSON.stringify(q)} max_turns=${MAX_TURNS}`
		);
		const key = await this.env.OPENROUTER_KEY.get();
		console.log(`[dr] openrouter key loaded (len=${key.length})`);
		const token_rate = Number(this.env.TOKEN_RATE) || 1.08;
		const ngn_usd = Number(this.env.NGN_USD) || 1440;
		const messages: Msg[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: q }
		];
		let answer = '';
		let cost_kobo = 0;
		for (let t = 0; t < MAX_TURNS && !answer; t++) {
			const force_finish = t === MAX_TURNS - 1 || cost_kobo >= budget_kobo;
			console.log(
				`[dr] turn ${t}/${MAX_TURNS - 1} :: messages=${messages.length} cost=${cost_kobo}/${budget_kobo} force_finish=${force_finish}`
			);
			const { message: m, usage } = await step.do(`llm-${t}`, RETRY, async () => {
				console.log(`[dr] llm-${t} :: calling model (force_finish=${force_finish})`);
				let resp;
				try {
					resp = await call_llm(key, messages, force_finish);
				} catch (e) {
					console.error(`[dr] llm-${t} :: call_llm FAILED :: ${String(e)}`);
					throw e;
				}
				console.log(
					`[dr] llm-${t} :: got message content_len=${resp.message.content?.length ?? 0} tool_calls=${(resp.message.tool_calls ?? []).length}`
				);
				for (const tc of resp.message.tool_calls ?? [])
					console.log(`[dr] llm-${t} :: tool_call name=${tc.function.name} args=${tc.function.arguments}`);
				for (const th of thoughts_from_msg(resp.message, t)) {
					console.log(`[dr] llm-${t} :: thought k=${th.k} c=${JSON.stringify(th.c).slice(0, 160)}`);
					await log_think(this.env, log_id, `llm-${t}-${th.k}`, th.k, t, th.c);
				}
				return resp;
			});
			if (usage) {
				const cache = usage.prompt_tokens_details?.cached_tokens ?? 0;
				const usd = calc_cost(MODEL, usage.prompt_tokens, usage.completion_tokens, cache);
				cost_kobo += kobo(usd, token_rate, ngn_usd);
				console.log(
					`[dr] llm-${t} :: usage in=${usage.prompt_tokens} out=${usage.completion_tokens} cache=${cache} cost_kobo=${cost_kobo}`
				);
			}
			messages.push(m);
			if (!m.tool_calls?.length) {
				console.log(`[dr] llm-${t} :: no tool_calls, prompting to continue`);
				messages.push({
					role: 'user',
					content:
						'Continue: call search_bible to research further, or call finish with your complete final answer.'
				});
				continue;
			}
			for (const c of m.tool_calls) {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(c.function.arguments || '{}');
				} catch {
					args = {};
				}
				if (c.function.name === 'finish') {
					const ans = String(args.answer ?? '');
					console.log(`[dr] llm-${t} :: finish called answer_len=${ans.length}`);
					answer = ans;
					if (answer) {
						console.log(`[dr] llm-${t} :: finish accepted, breaking`);
						break;
					}
					console.log(`[dr] llm-${t} :: finish REJECTED (empty), continuing`);
					messages.push({
						role: 'tool',
						tool_call_id: c.id,
						content:
							'finish rejected: answer was empty. Keep researching, then call finish with the full answer.'
					});
					continue;
				}
				console.log(
					`[dr] search-${t}-${c.id} :: query=${JSON.stringify(args.query)} scope=${args.scope} book=${args.book ?? ''} chapter=${args.chapter ?? ''}`
				);
				const r = await step.do(`search-${t}-${c.id}`, RETRY, async () => {
					console.log(`[dr] search-${t}-${c.id} :: calling search_bible`);
					let res: unknown;
					try {
						res = await search_bible(args);
					} catch (e) {
						console.error(`[dr] search-${t}-${c.id} :: search FAILED :: ${String(e)}`);
						throw e;
					}
					const arr = Array.isArray(res)
						? res
						: Array.isArray((res as { r?: unknown[] }).r)
							? (res as { r: unknown[] }).r
							: [];
					console.log(`[dr] search-${t}-${c.id} :: retrieved ${arr.length} passages`);
					for (const v of arr.slice(0, 12)) {
						const x = v as { b?: string; c?: number; v?: number; t?: string; s?: number };
						console.log(
							`[dr]   -> ${x.b} ${x.c}:${x.v} (s=${x.s != null ? x.s.toFixed(3) : '?'}) ${String(x.t ?? '').slice(0, 80)}`
						);
					}
					await log_think(
						this.env,
						log_id,
						`search-${t}-${c.id}`,
						'verses',
						t,
						`Retrieved ${arr.length} passage${arr.length === 1 ? '' : 's'}`
					);
					return res;
				});
				messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(r) });
			}
		}
		if (!answer)
			answer =
				[...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ??
				'No answer produced.';
		const spent = Math.min(cost_kobo, budget_kobo);
		console.log(`[dr] run complete :: answer_len=${answer.length} spent=${spent}`);
		let bal = 0;
		if (user_id) {
			try {
				bal = spent > 0 ? await deduct(this.env, user_id, spent) : await get_balance(this.env, user_id);
				console.log(`[dr] deducted ${spent} kobo, balance=${bal}`);
			} catch (e) {
				console.error(`[dr] deduct FAILED :: ${String(e)}`);
			}
		}
		return { q, m: `# question\n\n${q}\n\n# answer\n\n${answer}`, c: spent, b: bal };
	}
}

export class DrIndex {
	constructor(private state: DurableObjectState) {}
	async fetch(req: Request): Promise<Response> {
		const u = new URL(req.url);
		if (req.method === 'POST' && u.pathname === '/add') {
			const r = (await req.json()) as R;
			console.log(`[dr-index] add i=${r.i} l=${r.l}`);
			await this.state.storage.put(r.i, { i: r.i, q: r.q, l: r.l, c: r.c });
			return new Response('ok');
		}
		if (u.pathname === '/list') {
			const all = Array.from((await this.state.storage.list()).values()) as R[];
			all.sort((a, b) => (b.c ?? 0) - (a.c ?? 0));
			console.log(`[dr-index] list (${all.length})`);
			return new Response(JSON.stringify({ r: all }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		console.log(`[dr-index] unknown path ${req.method} ${u.pathname}`);
		return new Response('not found', { status: 404 });
	}
}

export default {
	async fetch(req: Request, env: E): Promise<Response> {
		const u = new URL(req.url);
		if (u.pathname === '/list') {
			const deny = await check_auth(req, env);
			if (deny) return deny;
			console.log(`[dr] fetch /list`);
			const idx = env.DR_INDEX.idFromName('index');
			const raw = await env.DR_INDEX.get(idx).fetch('https://do/list');
			const recs = (await raw.json()) as { r: R[] };
			for (const rec of recs.r) {
				try {
					const st = await (await env.DEEPRESEARCH_WF.get(rec.i)).status();
					rec.s = st.status;
				} catch {
					rec.s = 'unknown';
				}
			}
			return new Response(JSON.stringify({ r: recs.r }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		if (req.method === 'POST' && u.pathname === '/create') {
			const deny = await check_auth(req, env);
			if (deny) return deny;
			const { q, log_id, user_id, budget_kobo } = (await req.json()) as {
				q: string;
				log_id: string;
				user_id?: string;
				budget_kobo?: number;
			};
			console.log(`[dr] create proxy q=${JSON.stringify(q).slice(0, 120)} log_id=${log_id} user=${user_id ?? ''} budget=${budget_kobo ?? 0}`);
			const inst = await env.DEEPRESEARCH_WF.create({
				params: { q, log_id, user_id: user_id ?? '', budget_kobo: budget_kobo ?? 0 }
			});
			const idx = env.DR_INDEX.idFromName('index');
			await env.DR_INDEX.get(idx).fetch('https://do/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ i: inst.id, q, l: log_id, c: Date.now() })
			});
			return new Response(JSON.stringify({ id: inst.id }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const m = u.pathname.match(/^\/thoughts\/([^/]+)$/);
		if (m) {
			const deny = await check_auth(req, env);
			if (deny) return deny;
			console.log(`[dr] fetch /thoughts/${m[1]}`);
			const id = env.DR_LOG.idFromName(m[1]);
			return env.DR_LOG.get(id).fetch('https://do/thoughts');
		}
		const tm = u.pathname.match(/^\/terminate\/([^/]+)$/);
		if (tm) {
			const deny = await check_auth(req, env);
			if (deny) return deny;
			console.log(`[dr] terminate ${tm[1]}`);
			try {
				await env.DEEPRESEARCH_WF.get(tm[1]).terminate();
				return new Response(JSON.stringify({ ok: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			} catch (e) {
				return new Response(JSON.stringify({ error: String(e) }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}
		const sm = u.pathname.match(/^\/status\/([^/]+)$/);
		if (sm) {
			const deny = await check_auth(req, env);
			if (deny) return deny;
			const l = u.searchParams.get('l') ?? '';
			console.log(`[dr] fetch /status/${sm[1]} l=${l || '(none)'}`);
			try {
				const inst = await env.DEEPRESEARCH_WF.get(sm[1]);
				const st = await inst.status();
				let t: unknown[] = [];
				if (l) {
					const did = env.DR_LOG.idFromName(l);
					const dr = await env.DR_LOG.get(did).fetch('https://do/thoughts');
					if (dr.ok) t = (await dr.json() as { t: unknown[] }).t;
				}
				return new Response(JSON.stringify({ s: st.status, o: st.output ?? null, e: st.error ?? null, t }), {
					headers: { 'Content-Type': 'application/json' }
				});
			} catch {
				return new Response(JSON.stringify({ message: 'not found' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}
		console.log(`[dr] fetch unknown ${req.method} ${u.pathname}`);
		return new Response('ver-workflows', { status: 404 });
	}
};
