/// <reference types="@sveltejs/kit" />

import {
	systemPrompt,
	call_llm,
	search_bible,
	withRetry,
	FREE_SEARCHES,
	MODEL,
	EMBEDDING_MODEL,
	EMBEDDING_PRICE,
	type Msg,
	type RetryError
} from '$lib/deepresearch/core';
import { saveResearch, loadResearch, listResearch, deleteResearch, type ResearchState } from '$lib/deepresearch/sw-db';

function broadcast(data: unknown) {
	self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage(data)));
}

function search_cost_from_usage(usage?: { prompt_tokens: number }): number {
	return usage ? (usage.prompt_tokens / 1e6) * EMBEDDING_PRICE : 0;
}

const MAX_RUN_MS = 240_000;

function recordError(state: ResearchState, err: RetryError) {
	state.errors = state.errors || [];
	state.errors.push(err);
	state.updatedAt = Date.now();
	saveResearch(state);
	broadcast({ type: 'error-log', id: state.id, error: err });
}

async function runResearch(state: ResearchState, key: string): Promise<void> {
	const startTime = Date.now();
	const { id, question, maxSearches, maxRetries } = state;
	console.log('[sw:runResearch] id=%s maxSearches=%d searchesUsed=%d turn=%d', id.slice(0, 8), maxSearches, state.searchesUsed, state.turn);

	const messages: Msg[] =
		state.messages.length > 2
			? state.messages
			: [
					{ role: 'system', content: systemPrompt(maxSearches) },
					{ role: 'user', content: question }
				];
	let answer = '';
	let turn = state.turn;
	let searchesUsed = state.searchesUsed;
	const thoughtLog = state.thoughtLog.slice();
	let llm_cost = state.llm_cost ?? 0;
	let search_cost = state.search_cost ?? 0;

	while (!answer) {
		const llmResult = await withRetry(
			() => call_llm(key, messages),
			maxRetries,
			(re) => {
				recordError(state, re);
			},
			turn,
			'llm'
		);
		if (!llmResult) {
			const fatal: RetryError = {
				message: `LLM call failed after ${maxRetries} retries`,
				turn,
				attempt: maxRetries,
				timestamp: Date.now(),
				detail: ''
			};
			recordError(state, fatal);
			state.status = 'error';
			state.error = fatal.message;
			state.updatedAt = Date.now();
			await saveResearch(state);
			broadcast({ type: 'error', id, error: fatal.message });
			return;
		}
		const { message: m } = llmResult;
		turn++;

		if (m.content) thoughtLog.push({ k: 'think', n: turn, c: m.content, cost: llmResult.usage?.total_cost, cost_kind: 'llm' });
		for (const tc of m.tool_calls ?? []) {
			if (tc.function.name === 'search_bible') {
				let q = '';
				try {
					q = String(JSON.parse(tc.function.arguments || '{}').query ?? '');
				} catch {}
				thoughtLog.push({
					k: 'search',
					n: turn,
					c: q ? `Searching scripture: "${q}"` : 'Searching scripture…',
					cost: llmResult.usage?.total_cost,
					cost_kind: 'llm'
				});
			} else if (tc.function.name === 'finish') {
				thoughtLog.push({ k: 'finish', n: turn, c: 'Synthesizing final answer…', cost: llmResult.usage?.total_cost, cost_kind: 'llm' });
			}
		}

		messages.push(m);
		state.messages = messages;
		state.turn = turn;
		state.searchesUsed = searchesUsed;
		state.thoughtLog = thoughtLog;
		state.updatedAt = Date.now();
		await saveResearch(state);
		broadcast({ type: 'progress', id, searchesUsed, turn, thoughts: thoughtLog });

		if (!m.tool_calls?.length) {
			messages.push({
				role: 'user',
				content:
					'Continue: call search_bible to research further, or call finish with your complete final answer.'
			});
			continue;
		}

		let searchFailed = false;
		for (const c of m.tool_calls) {
			let args: Record<string, unknown>;
			try {
				args = JSON.parse(c.function.arguments || '{}');
			} catch {
				args = {};
			}

			if (c.function.name === 'finish') {
				const ans = String(args.answer ?? '');
				if (ans) {
					answer = ans;
					break;
				}
				messages.push({
					role: 'tool',
					tool_call_id: c.id,
					content:
						'finish rejected: answer was empty. Keep researching, then call finish with the full answer.'
				});
				continue;
			}

			if (c.function.name !== 'search_bible') continue;

			if (searchesUsed >= maxSearches) {
				thoughtLog.push({
					k: 'blocked',
					n: turn,
					c: `Search blocked — all ${maxSearches} searches used`
				});
				messages.push({
					role: 'tool',
					tool_call_id: c.id,
					content: `SEARCH BLOCKED: You have used all ${maxSearches} searches. You cannot search again. Call finish now to submit your answer.`
				});
				continue;
			}

			const searchResult = await withRetry(
				() => search_bible(args, '/api/search'),
				maxRetries,
				(re) => {
					recordError(state, re);
				},
				turn,
				'search'
			);
			if (!searchResult) {
				searchFailed = true;
				thoughtLog.push({
					k: 'error',
					n: turn,
					c: `Search failed after ${maxRetries} retries`
				});
				messages.push({
					role: 'tool',
					tool_call_id: c.id,
					content: `Error: Bible search failed after ${maxRetries + 1} attempts. Continue research with what you know so far, or call finish if you have enough.`
				});
				continue;
			}
			searchesUsed++;
			const s_cost = search_cost_from_usage(searchResult.usage);
			if (s_cost > 0) search_cost += s_cost;
			const res = searchResult as { r: unknown[] };
			thoughtLog.push({
				k: 'verses',
				n: turn,
				c: `Retrieved ${res.r.length} passage${res.r.length === 1 ? '' : 's'} (${searchesUsed}/${maxSearches} searches)`,
				cost: s_cost,
				cost_kind: 'search'
			});
			messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(res) });
		}

		if (searchFailed || searchesUsed !== state.searchesUsed) {
			state.searchesUsed = searchesUsed;
			state.thoughtLog = thoughtLog;
			state.updatedAt = Date.now();
			await saveResearch(state);
			broadcast({ type: 'progress', id, searchesUsed, turn, thoughts: thoughtLog });
		}

		if (Date.now() - startTime >= MAX_RUN_MS && !answer) {
			state.status = 'paused';
			state.updatedAt = Date.now();
			await saveResearch(state);
			broadcast({ type: 'paused', id, searchesUsed, turn, thoughts: thoughtLog });
			try {
				await self.registration.showNotification('Research Paused', {
					body: `"${question.slice(0, 80)}${question.length > 80 ? '…' : ''}" — open Ver to resume`,
					tag: `research-paused-${id}`
				});
			} catch {}
			return;
		}
	}

	const total_cost = llm_cost + search_cost;
	const cost_block =
		'\n\n---\n\n# research cost\n\n' +
		`- **LLM cost** (OpenRouter ${MODEL}): $${llm_cost.toFixed(6)}\n` +
		`- **Search cost** (embeddings ${EMBEDDING_MODEL}): $${search_cost.toFixed(6)}\n` +
		`- **Total research cost**: $${total_cost.toFixed(6)}\n`;
	state.status = 'complete';
	state.answer = answer + cost_block;
	state.thoughtLog = thoughtLog;
	state.llm_cost = llm_cost;
	state.search_cost = search_cost;
	state.total_cost = total_cost;
	state.updatedAt = Date.now();
	await saveResearch(state);
	broadcast({ type: 'complete', id, answer, question, thoughtLog, searchesUsed, turn });

	try {
		const clients = await self.clients.matchAll({ type: 'window' });
		if (clients.length === 0) {
			await self.registration.showNotification('Deep Research Complete', {
				body: `"${question.slice(0, 80)}${question.length > 80 ? '…' : ''}"`,
				tag: `research-${id}`
			});
		}
	} catch {}
}

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
	const d = event.data || {};
	const { type, id, question, key } = d;
	const maxSearches = d.maxSearches ?? FREE_SEARCHES;
	const maxRetries = d.maxRetries ?? 9;
	console.log('[sw:msg] received', { type, id: id?.slice(0, 8), maxSearches, maxRetries });

	if (type === 'start-research') {
		const state: ResearchState = {
			id,
			question,
			maxSearches,
			maxRetries,
			status: 'running',
			messages: [],
			searchesUsed: 0,
			turn: 0,
			thoughtLog: [],
			errors: [],
			answer: '',
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		event.waitUntil(
			saveResearch(state)
				.then(() => runResearch(state, key))
				.catch(async (e) => {
					console.error('[sw:msg] start-research error:', e);
					state.status = 'error';
					state.error = String(e);
					state.updatedAt = Date.now();
					await saveResearch(state);
					broadcast({ type: 'error', id, error: String(e) });
				})
		);
	}

	if (type === 'resume-research') {
		event.waitUntil(
			loadResearch(id).then((saved) => {
				if (!saved || (saved.status !== 'running' && saved.status !== 'paused')) {
					console.log('[sw:msg] resume: wrong status', saved?.status);
					return;
				}
				saved.status = 'running';
				console.log('[sw:msg] resume: turn=%d searchesUsed=%d/%d', saved.turn, saved.searchesUsed, saved.maxSearches);
				return runResearch(saved, key).catch(async (e) => {
					console.error('[sw:msg] resume error:', e);
					saved.status = 'error';
					saved.error = String(e);
					saved.updatedAt = Date.now();
					await saveResearch(saved);
					broadcast({ type: 'error', id, error: String(e) });
				});
			})
		);
	}

	if (type === 'get-status') {
		event.waitUntil(
			loadResearch(id).then((saved) => {
				if (saved) (event.source as Client)?.postMessage({ type: 'status', id, state: saved });
			})
		);
	}

	if (type === 'list-research') {
		event.waitUntil(
			listResearch().then((all) => {
				(event.source as Client)?.postMessage({ type: 'research-list', items: all });
			})
		);
	}

	if (type === 'delete-research') {
		event.waitUntil(deleteResearch(id));
	}
});
