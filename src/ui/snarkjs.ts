const BASE = import.meta.env.BASE_URL;
const SNARKJS_URL = `${BASE}vendor/snarkjs.min.js`;

let snarkjsPromise: Promise<any> | null = null;

/** Lazily load the hash-pinned checked-in snarkjs browser bundle once. */
export function loadSnarkjs(): Promise<any> {
  const host = window as unknown as { snarkjs?: any };
  if (host.snarkjs) return Promise.resolve(host.snarkjs);
  if (snarkjsPromise) return snarkjsPromise;

  snarkjsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SNARKJS_URL;
    script.async = true;
    script.onload = () =>
      host.snarkjs ? resolve(host.snarkjs) : reject(new Error('snarkjs global missing'));
    script.onerror = () => reject(new Error('failed to load snarkjs'));
    document.head.appendChild(script);
  });
  return snarkjsPromise;
}

export function artifactUrl(path: string): string {
  return `${BASE}zk/${path}`;
}
