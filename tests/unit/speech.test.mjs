/**
 * Dictation, which is off — and the machinery that would run it if it were not.
 *
 * `specs/07` asks for user-initiated dictation with a visible state, pause and
 * stop, and a typed fallback. It also says not to imply that recording works
 * before it has been integrated and tested. So the two things worth checking
 * are that nothing starts a microphone on its own, and that the unavailable
 * state says why rather than looking broken.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  dictation, browserRecogniser, recogniserExists, STATE, SAID, WHY_UNAVAILABLE,
} from "../../src/services/speech.mjs";

/** A recogniser that records what was asked of it and says what it heard. */
function fake() {
  const calls = [];
  const r = {
    started: 0,
    start() { calls.push("start"); r.started++; },
    stop() { calls.push("stop"); },
    onResult: null, onError: null, onEnd: null,
    calls,
  };
  return r;
}

/* ------------------------------------------------------------- switched off */

describe("with nothing supplied", () => {
  const d = () => dictation();

  test("it is unavailable, and says which kind of unavailable", () => {
    assert.equal(d().read().state, STATE.UNAVAILABLE);
    assert.equal(d().read().why, WHY_UNAVAILABLE.NOT_ENABLED);
    assert.match(d().read().why, /does not send what you write anywhere/);
  });

  test("the sentence says the microphone is off, first", () => {
    assert.match(d().read().said, /microphone is off/);
  });

  test("starting it does nothing at all", () => {
    const it = d();
    assert.equal(it.start().state, STATE.UNAVAILABLE);
    assert.equal(it.read().listening, false);
  });

  test("and typing is available in every state", () => {
    assert.equal(d().read().typing, true);
  });
});

/* ------------------------------------------------- the machine, when given one */

describe("with a recogniser", () => {
  let r, heard, it;
  beforeEach(() => {
    r = fake();
    heard = [];
    it = dictation({ recogniser: r, onText: (t) => heard.push(t) });
  });

  test("it does not start until somebody starts it", () => {
    assert.equal(it.read().state, STATE.IDLE);
    assert.equal(r.started, 0);
  });

  test("starting says it is listening, visibly", () => {
    assert.equal(it.start().state, STATE.LISTENING);
    assert.equal(r.started, 1);
    assert.match(it.read().said, /microphone is on/);
  });

  test("final text reaches the caller; a partial guess does not", () => {
    it.start();
    r.onResult("they will send the breakdown", false);
    assert.deepEqual(heard, []);
    r.onResult("they will send the breakdown", true);
    assert.deepEqual(heard, ["they will send the breakdown"]);
  });

  test("nothing is heard while paused", () => {
    it.start();
    it.pause();
    r.onResult("this should not be recorded", true);
    assert.deepEqual(heard, []);
    assert.equal(it.read().state, STATE.PAUSED);
    assert.match(it.read().said, /nothing is being heard/);
  });

  test("pausing stops the microphone underneath, not just the label", () => {
    it.start();
    it.pause();
    assert.deepEqual(r.calls, ["start", "stop"]);
  });

  test("and it can be started again afterwards", () => {
    it.start(); it.pause();
    assert.equal(it.start().state, STATE.LISTENING);
    r.onResult("back on", true);
    assert.deepEqual(heard, ["back on"]);
  });

  test("stopping is a state a person can see", () => {
    it.start();
    assert.equal(it.stop().state, STATE.STOPPED);
    assert.match(it.read().said, /microphone is off/);
  });

  test("a refused microphone says the browser refused, not that it failed", () => {
    it.start();
    r.onError("not-allowed");
    assert.equal(it.read().state, STATE.REFUSED);
    assert.match(it.read().said, /type the note instead/);
  });

  test("any other error says nothing already written has been lost", () => {
    it.start();
    r.onError("network");
    assert.equal(it.read().state, STATE.FAILED);
    assert.match(it.read().said, /has been lost/);
  });

  test("the recogniser ending by itself is a pause, not a stop", () => {
    /* Browsers end a session after a silence. Showing "stopped" for that
       teaches people the stop button does nothing. */
    it.start();
    r.onEnd();
    assert.equal(it.read().state, STATE.PAUSED);
  });

  test("every change is announced to whoever is drawing it", () => {
    const seen = [];
    const watched = dictation({ recogniser: fake(), onChange: (s) => seen.push(s.state) });
    watched.start();
    watched.pause();
    watched.stop();
    assert.deepEqual(seen, [STATE.LISTENING, STATE.PAUSED, STATE.STOPPED]);
  });

  test("a recogniser that throws on start leaves a state, not an exception", () => {
    const broken = fake();
    broken.start = () => { throw new Error("no microphone"); };
    const d = dictation({ recogniser: broken });
    assert.equal(d.start().state, STATE.FAILED);
    assert.match(d.read().why, /no microphone/);
  });
});

/* ---------------------------------------------------------- the browser one */

describe("the browser's recogniser", () => {
  test("is absent where the browser has none", () => {
    assert.equal(browserRecogniser({}), null);
    assert.equal(recogniserExists({}), false);
  });

  test("is found under either name", () => {
    const made = [];
    class Impl {
      constructor() { made.push(this); this.onresult = null; this.onerror = null; this.onend = null; }
      start() {} stop() {}
    }
    assert.ok(browserRecogniser({ SpeechRecognition: Impl }));
    assert.ok(browserRecogniser({ webkitSpeechRecognition: Impl }));
    assert.equal(recogniserExists({ webkitSpeechRecognition: Impl }), true);
    assert.equal(made.length, 2);
  });

  test("asks for final results only", () => {
    let built = null;
    class Impl {
      constructor() { built = this; }
      start() {} stop() {}
    }
    browserRecogniser({ SpeechRecognition: Impl });
    assert.equal(built.interimResults, false, "a partial guess would reach the notes");
    assert.equal(built.continuous, true);
  });

  test("hands on only what the browser marked final", () => {
    let built = null;
    class Impl {
      constructor() { built = this; }
      start() {} stop() {}
    }
    const wrapped = browserRecogniser({ SpeechRecognition: Impl });
    const seen = [];
    wrapped.onResult = (text, isFinal) => seen.push([text, isFinal]);

    built.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: "they will send it" }], { isFinal: true })],
    });
    assert.deepEqual(seen, [["they will send it", true]]);
  });
});

/* ------------------------------------------------------------ the promise */

describe("nothing in here reaches for a microphone on its own", () => {
  const source = readFileSync("src/services/speech.mjs", "utf8");

  test("it never reads a global", () => {
    /* The recogniser is handed in. A module that could find `window` could
       start a microphone the page did not ask for. */
    assert.equal(/\bwindow\./.test(source), false, "speech.mjs reads window");
    assert.equal(/\bnavigator\./.test(source), false, "speech.mjs reads navigator");
  });

  test("and it keeps no audio, because there is nowhere to keep it", () => {
    for (const sink of ["MediaRecorder", "localStorage", "indexedDB", "fetch(", "Blob"]) {
      assert.equal(source.includes(sink), false, `speech.mjs reaches for ${sink}`);
    }
  });
});
