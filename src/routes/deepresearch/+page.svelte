<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { loadKey, listResearch, type ResearchState } from '$lib/deepresearch/sw-db';
	import '$lib/deepresearch/dr.css';
	import { FREE_SEARCHES } from '$lib/deepresearch/core';

	let items = $state<ResearchState[]>([]);
	let q = $state('');
	let maxSearches = $state(FREE_SEARCHES);
	let maxRetries = $state(9);
	let starting = $state(false);
	let msg = $state('');
	let hasKey = $state(false);

	$effect(() => {
		if (!browser) return;
		loadKey().then((k) => (hasKey = !!k));
		load();
	});

	async function load() {
		const sw = await swReady();
		if (!sw) {
			msg = 'Service Worker not available';
			return;
		}
		const all = await listResearch();
		all.sort((a, b) => b.createdAt - a.createdAt);
		items = all.map((r) =>
			r.status === 'running' && Date.now() - r.updatedAt > 30_000
				? { ...r, status: 'paused' as const }
				: r
		);
	}

	function swReady(): Promise<boolean> {
		return new Promise((res) => {
			if (!('serviceWorker' in navigator)) {
				console.warn('[dr] serviceWorker not in navigator');
				return res(false);
			}
			navigator.serviceWorker.ready
				.then(() => {
					console.log('[dr] swReady: serviceWorker.ready resolved');
					res(true);
				})
				.catch((e) => {
					console.error('[dr] swReady: serviceWorker.ready rejected:', e);
					res(false);
				});
		});
	}

	function postMsg(data: Record<string, unknown>): Promise<void> {
		console.log('[dr:postMsg] waiting for active SW…');
		return new Promise((res, rej) => {
			let done = false;
			const ix = setInterval(async () => {
				const reg = await navigator.serviceWorker.ready;
				if (reg.active && !done) {
					done = true;
					clearInterval(ix);
					console.log('[dr:postMsg] SW active, posting message type=%s', (data as any).type);
					reg.active.postMessage(data);
					res();
				} else if (!done) {
					console.log('[dr:postMsg] reg.active is null, polling…');
				}
			}, 200);
			setTimeout(() => {
				if (done) return;
				done = true;
				clearInterval(ix);
				console.error('[dr:postMsg] TIMEOUT after 10s — SW never became active');
				rej(new Error('SW never became active within 10s'));
			}, 10_000);
		});
	}

	async function start() {
		console.log('[dr:start] called, q=%s, starting=%s, hasKey=%s', q.trim(), starting, hasKey);
		if (!q.trim() || starting) return;
		if (!hasKey) {
			console.log('[dr:start] no key, redirecting to /settings');
			goto('/settings');
			return;
		}
		starting = true;
		msg = '';
		try {
			const key = await loadKey();
			console.log('[dr:start] loadKey returned', key ? `key=${key.slice(0, 8)}…` : 'undefined');
			if (!key) {
				msg = 'Set your OpenRouter API key in settings first.';
				return;
			}
			const id = crypto.randomUUID();
			console.log('[dr:start] generated id=%s, calling postMsg…', id);
			console.log('[dr:start] payload', { id, maxSearches: Math.max(1, maxSearches), maxRetries: Math.max(0, maxRetries) });
			await postMsg({
				type: 'start-research',
				id,
				question: q.trim(),
				maxSearches: Math.max(1, maxSearches),
				maxRetries: Math.max(0, maxRetries),
				key
			});
			console.log('[dr:start] postMsg resolved, navigating to detail page');
			goto(`/deepresearch/${id}?q=${encodeURIComponent(q.trim())}`);
		} catch (e) {
			console.error('[dr:start] caught error:', e);
			msg = `failed to start: ${String(e)}`;
		} finally {
			starting = false;
			console.log('[dr:start] finally, starting=%s', starting);
		}
	}

	function ago(ts: number): string {
		const s = Math.floor((Date.now() - ts) / 1000);
		if (s < 60) return `${s}s ago`;
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		return `${Math.floor(s / 86400)}d ago`;
	}

	function badge(s: string): string {
		return s === 'complete' ? 'done' : s === 'error' ? 'err' : s === 'paused' ? 'paused' : 'run';
	}
</script>

<svelte:head>
	<title>Deep Bible Research</title>
	<meta
		name="description"
		content="Long-running, first-principles Bible research synthesized purely from retrieved scripture."
	/>
</svelte:head>

<main>
	<header class="hero">
		<p class="kicker">Young's Literal Translation</p>
		<h1>Deep Research</h1>
		<p class="lede">
			Start a question, or open any past research below. An agent searches scripture exhaustively
			and synthesizes an answer from the retrieved text alone — leave it open or come back later.
		</p>
	</header>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			start();
		}}
	>
		<textarea
			placeholder="e.g. What does the Bible itself say bread means, from Genesis to Revelation?"
			bind:value={q}
			rows="3"
			aria-label="Research question"
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					start();
				}
			}}></textarea>
		<div class="row">
			<label class="steps">
				Max searches
				<input type="number" min="1" bind:value={maxSearches} aria-label="Max searches" />
			</label>
			<label class="steps">
				Retries
				<input type="number" min="0" max="99" bind:value={maxRetries} aria-label="Max retries" />
			</label>
			<button type="submit" disabled={starting}>{starting ? 'Starting…' : 'Start research'}</button>
		</div>
		<p class="hint">
			First {FREE_SEARCHES} searches free{hasKey ? '. The model decides how many thinking turns to use.' : '; '}
			{hasKey ? '' : 'set your OpenRouter key in '}
			<a href="/settings">settings</a>
			{hasKey ? '' : ' to start.'}
		</p>
	</form>
	{#if msg}
		<p class="msg">{msg}</p>
	{/if}

	<section class="list">
		{#each items as r (r.id)}
			<a
				class="item"
				href={`/deepresearch/${r.id}?q=${encodeURIComponent(r.question)}`}
			>
				<span class="q">{r.question}</span>
				<span class="meta">
					{#if r.searchesUsed}
						<span class="time">{r.searchesUsed}/{r.maxSearches} searches</span>
					{/if}
					<span class={`badge ${badge(r.status)}`}>{r.status}</span>
					<span class="time">{ago(r.createdAt)}</span>
				</span>
			</a>
		{:else}
			<p class="empty">No research yet — ask the first question above.</p>
		{/each}
	</section>
</main>

<style>
	.lede {
		margin: 0.75rem auto 0;
		max-width: 34rem;
		color: #475569;
		font-size: 1.05rem;
		line-height: 1.5;
	}
	form {
		display: grid;
		gap: 0.6rem;
		background: #ffffff;
		padding: 0.7rem;
		border: 1px solid #dbe3f0;
		border-radius: 14px;
		box-shadow: 0 1px 2px rgba(22, 35, 63, 0.04), 0 12px 30px -18px rgba(22, 35, 63, 0.25);
	}
	textarea {
		width: 100%;
		padding: 0.8rem 0.9rem;
		font-size: 1rem;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		resize: vertical;
	}
	textarea:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.steps {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #475569;
	}
	.steps input {
		width: 5rem;
		padding: 0.5rem 0.6rem;
		font-size: 1rem;
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
	}
	.steps input:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}
	.hint {
		margin: 0;
		font-size: 0.82rem;
		color: #94a3b8;
	}
	.list {
		margin-top: 2rem;
		display: grid;
		gap: 0.6rem;
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		text-decoration: none;
		padding: 0.9rem 1.1rem;
		background: #fff;
		border: 1px solid #e4e9f2;
		border-radius: 12px;
		transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
	}
	.msg {
		text-align: left;
		color: #1d4ed8;
		margin: 1rem 0 0;
		font-size: 0.98rem;
	}
	.item:hover {
		border-color: #2563eb;
		box-shadow: 0 10px 26px -18px rgba(22, 35, 63, 0.4);
		transform: translateY(-1px);
	}
	.q {
		color: #16233f;
		font-size: 1.02rem;
		font-weight: 500;
		line-height: 1.35;
		word-break: break-word;
	}
	.meta {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.badge {
		text-transform: uppercase;
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		font-weight: 700;
		padding: 0.18rem 0.5rem;
		border-radius: 999px;
		color: #fff;
	}
	.badge.run {
		background: #0891b2;
	}
	.badge.done {
		background: #059669;
	}
	.badge.err {
		background: #dc2626;
	}
	.badge.paused {
		background: #d97706;
	}
	.time {
		font-size: 0.78rem;
		color: #94a3b8;
		white-space: nowrap;
	}
	.empty {
		text-align: left;
		color: #94a3b8;
		margin-top: 1.5rem;
	}
</style>
