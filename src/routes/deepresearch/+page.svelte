<script lang="ts">
	import { marked } from 'marked';
	import { slug } from '$lib/deepresearch/core';

	type O = { q: string; m: string };
	let q = $state('');
	let i = $state('');
	let s = $state('');
	let o = $state<O | null>(null);
	let msg = $state('');
	let starting = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	if (typeof localStorage !== 'undefined') {
		const saved = localStorage.getItem('dr');
		if (saved) {
			const p = JSON.parse(saved);
			q = p.q ?? '';
			i = p.i ?? '';
		}
	}

	async function poll() {
		if (!i) return;
		try {
			const res = await fetch(`/api/deepresearch/${i}`);
			if (!res.ok) {
				stop_poll();
				msg =
					res.status === 404 ? 'research not found (it may have expired)' : 'status check failed';
				return;
			}
			const d = (await res.json()) as { s: string; o: O | null; e: unknown };
			s = d.s;
			if (d.s === 'complete') {
				o = d.o;
				stop_poll();
			} else if (d.s === 'errored' || d.s === 'terminated') {
				msg = `research ${d.s}${d.e ? `: ${JSON.stringify(d.e)}` : ''}`;
				stop_poll();
			}
		} catch {
			/* transient network error: keep polling */
		}
	}

	function stop_poll() {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	$effect(() => {
		if (i && !o) {
			poll();
			timer = setInterval(poll, 5000);
		}
		return stop_poll;
	});

	async function start() {
		if (!q.trim() || starting) return;
		starting = true;
		msg = '';
		o = null;
		s = '';
		try {
			const res = await fetch('/api/deepresearch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ q })
			});
			const d = (await res.json()) as { i?: string; message?: string };
			if (!res.ok || !d.i) {
				msg = d.message ?? 'failed to start';
				return;
			}
			i = d.i;
			localStorage.setItem('dr', JSON.stringify({ q, i }));
		} catch {
			msg = 'failed to start';
		} finally {
			starting = false;
		}
	}

	function download() {
		if (!o) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([o.m], { type: 'text/markdown' }));
		a.download = `${slug(o.q)}.md`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function reset() {
		stop_poll();
		q = '';
		i = '';
		s = '';
		o = null;
		msg = '';
		localStorage.removeItem('dr');
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
			Ask a question. An agent searches scripture exhaustively and synthesizes an answer from the
			retrieved text alone. This can take a long time — leave this page open or come back later.
		</p>
	</header>

	{#if !i}
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
				aria-label="Research question"></textarea>
			<button type="submit" disabled={starting}>{starting ? 'Starting…' : 'Start research'}</button>
		</form>
	{:else if !o}
		<section class="status">
			<p class="question">“{q}”</p>
			{#if msg}
				<p class="msg">{msg}</p>
				<button type="button" class="ghost" onclick={reset}>New research</button>
			{:else}
				<div class="spinner" aria-hidden="true"></div>
				<p class="msg muted">Researching… status: {s || 'starting'}</p>
			{/if}
		</section>
	{:else}
		<section class="result">
			<div class="bar">
				<button type="button" onclick={download}>Download .md</button>
				<button type="button" class="ghost" onclick={reset}>New research</button>
			</div>
			<article class="md">{@html String(marked.parse(o.m))}</article>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.25rem 5rem;
	}
	.hero {
		text-align: center;
		margin-bottom: 2.5rem;
	}
	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.22em;
		font-size: 0.7rem;
		color: #1e40af;
		margin: 0 0 0.6rem;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}
	h1 {
		font-size: clamp(2.2rem, 6vw, 3.2rem);
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.01em;
		color: #16233f;
	}
	.lede {
		margin: 0.75rem auto 0;
		max-width: 32rem;
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
		box-shadow:
			0 1px 2px rgba(22, 35, 63, 0.04),
			0 12px 30px -18px rgba(22, 35, 63, 0.25);
	}
	textarea {
		width: 100%;
		padding: 0.8rem 0.9rem;
		font-size: 1rem;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
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
	button {
		height: 3rem;
		padding: 0 1.4rem;
		font-size: 1rem;
		font-weight: 600;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: #fff;
		background: #1d4ed8;
		border: none;
		border-radius: 9px;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #1e40af;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	button.ghost {
		color: #1d4ed8;
		background: #eef2f9;
		border: 1px solid #dbe3f0;
	}
	.status {
		text-align: center;
		margin-top: 2rem;
	}
	.question {
		color: #16233f;
		font-size: 1.1rem;
	}
	.spinner {
		width: 2rem;
		height: 2rem;
		margin: 1.2rem auto 0;
		border: 3px solid #dbe3f0;
		border-top-color: #1d4ed8;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.msg {
		text-align: center;
		color: #1d4ed8;
		margin: 1.2rem 0;
		font-size: 0.98rem;
	}
	.msg.muted {
		color: #94a3b8;
	}
	.result {
		margin-top: 2rem;
	}
	.bar {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		margin-bottom: 1.2rem;
	}
	.md {
		background: #ffffff;
		border: 1px solid #e4e9f2;
		border-radius: 12px;
		padding: 1.5rem 1.75rem;
		line-height: 1.7;
		color: #1e293b;
	}
	.md :global(h1) {
		font-size: 1.5rem;
		color: #16233f;
	}
	.md :global(h2) {
		font-size: 1.2rem;
		color: #16233f;
	}
	.md :global(blockquote) {
		border-left: 3px solid #c3d0ea;
		margin: 1rem 0;
		padding: 0.2rem 1rem;
		color: #475569;
	}
	.md :global(code) {
		background: #eef2f9;
		border-radius: 4px;
		padding: 0.1rem 0.35rem;
	}
</style>
