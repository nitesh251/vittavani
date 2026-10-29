import assert from "node:assert/strict";
import test from "node:test";

import {
  getSpeechRecognitionConstructor,
  startSpeechRecognition,
} from "../lib/speech-recognition.mjs";

function callbacks() {
  return {
    transcripts: [],
    errors: [],
    ended: [],
    started: [],
    startFailures: 0,
    onTranscript(transcript) { this.transcripts.push(transcript); },
    onError(message) { this.errors.push(message); },
    onEnd(state) { this.ended.push(state); },
    onStarted(recognition) { this.started.push(recognition); },
    onStartFailure() { this.startFailures += 1; },
  };
}

function browserWithRecognition(start = () => {}) {
  class FakeRecognition {
    constructor() {
      this.lang = "";
      this.continuous = true;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }

    start() { start(this); }
    stop() {}
    abort() {}
  }

  return { webkitSpeechRecognition: FakeRecognition };
}

test("reports unsupported browsers without starting recognition", () => {
  const result = startSpeechRecognition({}, "hi-IN", callbacks());

  assert.equal(getSpeechRecognitionConstructor({}), null);
  assert.equal(result, "unsupported");
});

test("starts the WebKit speech API with the chosen language and delivers transcripts", () => {
  const events = callbacks();
  const result = startSpeechRecognition(browserWithRecognition(), "hi-IN", events);
  const recognition = events.started[0];

  assert.equal(result, "started");
  assert.equal(recognition.lang, "hi-IN");
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, true);
  recognition.onresult({
    resultIndex: 0,
    results: [[{ transcript: "Amul butter" }], [{ transcript: "stock kitna hai" }]],
  });
  recognition.onend();

  assert.deepEqual(events.transcripts, ["Amul butter stock kitna hai"]);
  assert.deepEqual(events.ended, [{ receivedTranscript: true, recognitionFailed: false }]);
});

test("turns denied microphone permission into a typing fallback", () => {
  const events = callbacks();
  startSpeechRecognition(browserWithRecognition(), "en-IN", events);
  const recognition = events.started[0];

  recognition.onerror({ error: "not-allowed" });
  recognition.onend();

  assert.match(events.errors[0], /permission was denied/i);
  assert.match(events.errors[0], /type your question/i);
  assert.deepEqual(events.ended, [{ receivedTranscript: false, recognitionFailed: true }]);
});

test("reports empty recognition sessions without claiming a transcript", () => {
  const events = callbacks();
  startSpeechRecognition(browserWithRecognition(), "hi-IN", events);
  events.started[0].onend();

  assert.deepEqual(events.transcripts, []);
  assert.deepEqual(events.ended, [{ receivedTranscript: false, recognitionFailed: false }]);
});

test("handles microphone start exceptions without reporting a listening session", () => {
  const events = callbacks();
  const result = startSpeechRecognition(
    browserWithRecognition(() => { throw new Error("microphone unavailable"); }),
    "hi-IN",
    events,
  );

  assert.equal(result, "failed");
  assert.deepEqual(events.started, []);
  assert.equal(events.startFailures, 1);
});
