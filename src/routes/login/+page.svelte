<script lang="ts">
	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let password = $state('');
	let msg = $state('');
	let busy = $state(false);

	async function submit() {
		if (busy) return;
		busy = true;
		msg = '';
		try {
			const r = await fetch(`/api/auth/${mode}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ e: email, p: password })
			});
			const d = (await r.json().catch(() => ({}))) as { message?: string };
			if (r.ok) location.href = '/deepresearch';
			else msg = d.message ?? (mode === 'login' ? 'invalid credentials' : 'registration failed');
		} catch {
			msg = 'network error';
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
	<a class="google" href="/login/google">Continue with Google</a>
	<div class="sep">or</div>
	<form onsubmit={(e) => { e.preventDefault(); submit(); }}>
		<input type="email" placeholder="Email" bind:value={email} autocomplete="email" />
		<input type="password" placeholder="Password" bind:value={password} autocomplete="current-password" />
		<button type="submit" disabled={busy}>{busy ? '…' : mode === 'login' ? 'Sign in' : 'Sign up'}</button>
	</form>
	{#if msg}<p class="msg">{msg}</p>{/if}
	<button class="switch" onclick={() => (mode = mode === 'login' ? 'register' : 'login')}>
		{mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
	</button>
</main>

<style>
	main {
		max-width: 380px;
		margin: 5rem auto;
		padding: 0 1.25rem;
		text-align: center;
	}
	h1 {
		color: #16233f;
		margin-bottom: 1.5rem;
	}
	.google {
		display: block;
		padding: 0.8rem;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		text-decoration: none;
		color: #16233f;
		font-weight: 600;
		background: #fff;
	}
	.sep {
		color: #94a3b8;
		font-size: 0.8rem;
		margin: 1rem 0;
	}
	form {
		display: grid;
		gap: 0.6rem;
	}
	input {
		padding: 0.8rem;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		font-size: 1rem;
		outline: none;
		background: #fff;
		color: #16233f;
	}
	input:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}
	button[type='submit'] {
		padding: 0.8rem;
		border: none;
		border-radius: 9px;
		background: #1d4ed8;
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
	}
	button[type='submit']:disabled {
		opacity: 0.6;
	}
	.msg {
		color: #dc2626;
		font-size: 0.9rem;
	}
	.switch {
		margin-top: 1.2rem;
		background: none;
		border: none;
		color: #1d4ed8;
		cursor: pointer;
		font-size: 0.9rem;
	}
</style>
