<script lang="ts">
	let done = $state(false);
	$effect(() => {
		const ref = new URLSearchParams(location.search).get('reference');
		if (ref) {
			fetch('/api/billing/verify-payment', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reference: ref })
			})
				.then(() => (done = true))
				.catch(() => (done = true));
		}
	});
</script>

<main class="wrap">
	<h1>Payment</h1>
	<p>{done ? 'Payment processed. Your balance has been updated.' : 'Processing payment…'}</p>
	<a class="link" href="/deepresearch">Back to research</a>
</main>

<style>
	.wrap {
		max-width: 520px;
		margin: 0 auto;
		padding: 4rem 1.25rem;
		text-align: center;
	}
	h1 {
		font-size: 1.8rem;
		color: #16233f;
	}
	p {
		color: #475569;
		margin: 1rem 0 2rem;
	}
	.link {
		color: #1d4ed8;
		font-weight: 600;
	}
</style>
