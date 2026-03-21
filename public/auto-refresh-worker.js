var timerId = null;
var intervalMs = 60000;

function tick() {
  self.postMessage({ type: "tick" });
  timerId = setTimeout(tick, intervalMs);
}

self.onmessage = function (event) {
  var data = event.data;
  if (data.type === "start") {
    intervalMs = data.interval > 0 ? data.interval : 60000;
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(tick, intervalMs);
  } else if (data.type === "stop") {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }
};
