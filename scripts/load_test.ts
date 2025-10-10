// scripts/load_test.ts
const target = process.env.TARGET || 'http://localhost:3000/v1/jobs';
const jwt = process.env.JWT || '';
const concurrency = Number(process.env.C || '8');   // parallel workers
const durationSec = Number(process.env.D || '180'); // seconds

const body = JSON.stringify({
  sourceId: "seed",
  ops: [
    { op: "resize",  width: 7680, height: 4320 },
    { op: "blur",    sigma: 10 },
    { op: "sharpen", sigma: 2 },
    { op: "resize",  width: 7680, height: 4320 }
  ]
});

async function once() {
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body
    });
    await res.text().catch(()=>{});
  } catch {}
}
async function worker(stopAt: number) { while (Date.now() < stopAt) await once(); }
(async () => {
  if (!jwt) { console.error('Set JWT env var (JWT=...)'); process.exit(1); }
  const stopAt = Date.now() + durationSec * 1000;
  await Promise.all(Array.from({ length: concurrency }, () => worker(stopAt)));
  console.log('Load test finished.');
})();
