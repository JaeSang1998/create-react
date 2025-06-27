// scheduler.ts
const SLICE_MS = 5;
const q: (() => void)[] = [];
let flushing = false;
const ch = new MessageChannel();

ch.port2.onmessage = () => {
  flushing = false;
  const start = performance.now();
  let cb = q.shift();

  // 시간 분할: 5ms 동안만 작업 수행
  while (cb) {
    cb();
    if (performance.now() - start > SLICE_MS) break;
    cb = q.shift();
  }

  // 남은 작업이 있으면 다시 스케줄링
  if (q.length) flush();
};

function flush() {
  if (!flushing) {
    flushing = true;
    ch.port1.postMessage(null);
  }
}

export function schedule(cb: () => void) {
  q.push(cb);
  if (!flushing) flush();
}
