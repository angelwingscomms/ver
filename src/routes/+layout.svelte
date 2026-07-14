<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';

	let { data, children } = $props();
	let user = $state<{ id: string; name: string; picture?: string; email?: string } | null>(data.user);
	let balance = $state(data.balance);
	let show_dep = $state(false);
	let buy_input = $state('');
	let buy_loading = $state(false);
	const MIN_KOBO = 10_000;

	$effect(() => {
		user = data.user;
		balance = data.balance;
	});

	$effect(() => {
		if (!browser) return;
		function handler(e: Event) {
			balance = (e as CustomEvent).detail;
		}
		window.addEventListener('balance-update', handler);
		return () => window.removeEventListener('balance-update', handler);
	});

	function refresh() {
		fetch('/api/balance')
			.then((r) => r.json())
			.then((d: { balance: number }) => {
				balance = d.balance;
				window.dispatchEvent(new CustomEvent('balance-update', { detail: balance }));
			})
			.catch(() => {});
	}

	async function deposit(amount_kobo: number) {
		buy_loading = true;
		let auth_url = '';
		try {
			const r = await fetch('/api/billing/buy-tokens', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount_kobo })
			});
			const d = (await r.json()) as { access_code?: string; authorization_url?: string; error?: string };
			if (!d.access_code) {
				alert(d.error || 'Failed to initialize payment');
				buy_loading = false;
				return;
			}
			auth_url = d.authorization_url;
			const PaystackPop = (await import('@paystack/inline-js')).default as new () => {
				resumeTransaction: (
					code: string,
					cb: {
						onSuccess: (tx: { reference: string }) => void;
						onCancel: () => void;
						onError: () => void;
					}
				) => void;
			};
			const popup = new PaystackPop();
			const fb = setTimeout(() => (window.location.href = auth_url), 15000);
			popup.resumeTransaction(d.access_code, {
				onSuccess: (tx) => {
					clearTimeout(fb);
					fetch('/api/billing/verify-payment', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ reference: tx.reference })
					})
						.then(() => refresh())
						.catch(() => refresh())
						.finally(() => (buy_loading = false));
				},
				onCancel: () => {
					clearTimeout(fb);
					buy_loading = false;
				},
				onError: () => {
					clearTimeout(fb);
					window.location.href = auth_url;
				}
			});
		} catch {
			if (auth_url) window.location.href = auth_url;
			else {
				alert('Network error');
				buy_loading = false;
			}
		}
	}

	async function logout() {
		await fetch('/logout', { method: 'POST' });
		user = null;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="nav">
	<div class="nav-in">
		<a class="brand" href="/">Ver</a>
		<div class="nav-end">
			{#if user}
				<a class="bal" href="/deepresearch">₦{(balance / 100).toFixed(2)}</a>
				<button class="btn ghost" onclick={() => (show_dep = true)}>Deposit</button>
				<button class="btn ghost" onclick={logout}>Logout</button>
			{:else}
				<a class="btn" href="/login">Login</a>
			{/if}
		</div>
	</div>
</nav>

{#if show_dep}
	<div
		class="modal"
		role="presentation"
		onclick={() => (show_dep = false)}
	>
		<div class="card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2>Deposit</h2>
			<div class="inp">
				<span>₦</span>
				<input type="number" min={MIN_KOBO / 100} bind:value={buy_input} placeholder="100" />
			</div>
			<p class="hint">Min: ₦100</p>
			<button
				class="btn block"
				disabled={buy_loading || !buy_input || parseInt(buy_input) <= 0}
				onclick={() => deposit(parseInt(buy_input) * 100 || MIN_KOBO)}
			>
				{buy_loading ? 'Processing…' : `Deposit ₦${(parseInt(buy_input) * 100 || MIN_KOBO) / 100}`}
			</button>
			<button class="btn ghost block" onclick={() => (show_dep = false)}>Close</button>
		</div>
	</div>
{/if}

{@render children()}

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #f3f6fb;
		color: #16233f;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			Helvetica,
			Arial,
			sans-serif;
		-webkit-font-smoothing: antialiased;
		text-rendering: optimizeLegibility;
	}
	:global(*) {
		box-sizing: border-box;
	}
	:global(a) {
		color: #1d4ed8;
	}
	.nav {
		border-bottom: 1px solid #dbe3f0;
		background: #fff;
		position: sticky;
		top: 0;
		z-index: 50;
	}
	.nav-in {
		max-width: 980px;
		margin: 0 auto;
		padding: 0.7rem 1.25rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.brand {
		font-weight: 700;
		font-size: 1.1rem;
		color: #16233f;
		text-decoration: none;
	}
	.nav-end {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.bal {
		font-weight: 600;
		color: #16233f;
		text-decoration: none;
	}
	.btn {
		height: 2.4rem;
		padding: 0 1rem;
		font-size: 0.92rem;
		font-weight: 600;
		color: #fff;
		background: #1d4ed8;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.btn:hover:not(:disabled) {
		background: #1e40af;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.ghost {
		color: #1d4ed8;
		background: #eef2f9;
		border: 1px solid #dbe3f0;
	}
	.btn.block {
		width: 100%;
		margin-top: 0.5rem;
	}
	.modal {
		position: fixed;
		inset: 0;
		background: rgba(22, 35, 63, 0.45);
		display: grid;
		place-items: center;
		z-index: 60;
		padding: 1rem;
	}
	.card {
		background: #fff;
		border-radius: 14px;
		padding: 1.5rem;
		width: 100%;
		max-width: 360px;
		box-shadow: 0 24px 80px rgba(20, 20, 19, 0.22);
	}
	.card h2 {
		margin: 0 0 1rem;
		color: #16233f;
	}
	.inp {
		display: flex;
		align-items: center;
		border: 1px solid #dbe3f0;
		border-radius: 8px;
		padding-left: 0.7rem;
	}
	.inp span {
		color: #94a3b8;
	}
	.inp input {
		flex: 1;
		border: none;
		padding: 0.7rem;
		font-size: 1rem;
		outline: none;
		background: transparent;
		color: #16233f;
	}
	.hint {
		color: #94a3b8;
		font-size: 0.72rem;
		margin: 0.4rem 0 0;
	}
</style>
