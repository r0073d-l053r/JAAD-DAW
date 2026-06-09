// Let's just use simple performance.now()
const { performance } = require('perf_hooks');

const track = {
  clips: Array.from({ length: 10000 }, (_, i) => ({ start: i, duration: 10 }))
};

function original() {
  return Math.max(0, ...track.clips.map((c) => c.start + c.duration)) + 5;
}

function optimizedLoop() {
  let maxDuration = 0;
  for (let i = 0; i < track.clips.length; i++) {
    const end = track.clips[i].start + track.clips[i].duration;
    if (end > maxDuration) {
      maxDuration = end;
    }
  }
  return maxDuration + 5;
}

function optimizedReduce() {
  return track.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0) + 5;
}

function runBenchmark(name, fn, iterations = 1000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  console.log(`${name}: ${end - start} ms`);
}

console.log("Warming up...");
original();
optimizedLoop();
optimizedReduce();

console.log("Running benchmarks with 10,000 items...");
runBenchmark("original", original, 1000);
runBenchmark("optimizedLoop", optimizedLoop, 1000);
runBenchmark("optimizedReduce", optimizedReduce, 1000);
