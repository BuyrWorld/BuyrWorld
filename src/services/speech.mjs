/**
 * Dictation, which is off.
 *
 * `specs/07`: *"user-initiated dictation if configured, visible
 * recording/transcription state, pause/stop, typed fallback"*, and *"Do not
 * imply real-time call recording or mobile push works until integrated and
 * tested."*
 *
 * The browser has a recogniser — `SpeechRecognition`, or `webkitSpeechRecognition`
 * on the ones that shipped it first — and it is two lines to start. The reason
 * this file does not is that on the common implementation the audio is sent to
 * the vendor's servers to be recognised. This site tells people it collects
 * nothing and sends nothing; a microphone that quietly streams a supplier
 * negotiation to a third party would make that untrue in the worst possible
 * place, and a footnote would not fix it.
 *
 * So what is built is the whole thing except the decision: a state machine
 * somebody can see, start, pause, stop; a recogniser supplied from outside
 * rather than reached for; and an unavailable state that says *why* rather than
 * greying a button out. With nothing supplied — which is this build — it is
 * unavailable, typing works, and the page says what would have to be true for
 * it to work.
 *
 * Three things it will not do, whatever it is given:
 *
 *   - **Start itself.** `start()` exists to be called from a click. Nothing in
 *     here begins listening on load, on route change, or on a note being typed.
 *   - **Keep the audio.** What comes back is text, handed straight to the
 *     caller. There is no buffer, no recording, and nowhere to write one.
 *   - **Decide anything.** A transcript is a note like a typed one, marked as
 *     dictated so that what is read out of it carries that with it.
 */

/** Where the microphone is, in words a person can be shown. */
export const STATE = Object.freeze({
  UNAVAILABLE: "unavailable",
  IDLE: "idle",
  LISTENING: "listening",
  PAUSED: "paused",
  STOPPED: "stopped",
  REFUSED: "refused",
  FAILED: "failed",
});

/**
 * What each state says on screen.
 *
 * `specs/07` asks for a *visible* recording state. The word people need is not
 * "idle" but whether the microphone is on, so each of these answers that first.
 */
export const SAID = Object.freeze({
  [STATE.UNAVAILABLE]:
    "Dictation is not switched on in this build. The microphone is off, and typing is the way "
    + "notes are taken here.",
  [STATE.IDLE]: "The microphone is off. Start it when you want to dictate.",
  [STATE.LISTENING]: "The microphone is on and words are being added to your notes.",
  [STATE.PAUSED]: "Paused. The microphone is off and nothing is being heard.",
  [STATE.STOPPED]: "Stopped. The microphone is off.",
  [STATE.REFUSED]:
    "The browser refused the microphone. Nothing is being heard; type the note instead.",
  [STATE.FAILED]:
    "Dictation stopped working, so the microphone is off. Type the note instead — nothing "
    + "that was already written has been lost.",
});

/**
 * Why it is unavailable, said once and properly.
 *
 * Two different reasons, and telling them apart matters: one is a browser that
 * cannot, the other is a decision this build made. A person on a browser that
 * would work deserves to know it is us rather than them.
 */
export const WHY_UNAVAILABLE = Object.freeze({
  NOT_ENABLED:
    "This build does not switch dictation on. The recogniser browsers provide sends the audio "
    + "to the browser vendor to be transcribed, and this site does not send what you write "
    + "anywhere. Turning it on is a decision about that, not a missing feature.",
  NO_RECOGNISER:
    "This browser has no speech recogniser, so there is nothing to switch on here.",
});

/**
 * The thing on the page.
 *
 * `recogniser` is supplied rather than found: this module never reads a global,
 * so it cannot start a microphone the page did not hand it. `onText` receives
 * final transcripts only — a partial result is a guess being revised in public,
 * and a note is not the place for one.
 */
export function dictation({ recogniser = null, onText = null, onChange = null } = {}) {
  let state = recogniser ? STATE.IDLE : STATE.UNAVAILABLE;
  let why = recogniser ? null : WHY_UNAVAILABLE.NOT_ENABLED;

  const move = (to, reason = null) => {
    state = to;
    why = reason;
    if (onChange) onChange(snapshot());
    return snapshot();
  };

  const snapshot = () => Object.freeze({
    state,
    said: SAID[state],
    why,
    listening: state === STATE.LISTENING,
    /* Whether a person can type instead. Always true, at every state, which is
       the point of naming it rather than leaving it implied. */
    typing: true,
  });

  if (recogniser) {
    recogniser.onResult = (text, isFinal) => {
      if (!isFinal || state !== STATE.LISTENING) return;
      const said = String(text ?? "").trim();
      if (said && onText) onText(said);
    };
    recogniser.onError = (kind) => {
      stopUnderneath();
      move(kind === "not-allowed" ? STATE.REFUSED : STATE.FAILED,
        kind ? `The browser reported "${kind}".` : null);
    };
    recogniser.onEnd = () => {
      /* The browser's recogniser ends by itself after a silence. That is not a
         person stopping, and showing "stopped" for it would teach people the
         button does nothing. */
      if (state === STATE.LISTENING) move(STATE.PAUSED);
    };
  }

  function stopUnderneath() {
    try { recogniser?.stop?.(); } catch (e) { /* already stopped */ }
  }

  return Object.freeze({
    /** What to show, right now. */
    read: snapshot,

    /** Begin listening. Called from a click, and from nothing else. */
    start() {
      if (!recogniser) return snapshot();
      if (state === STATE.LISTENING) return snapshot();
      try {
        recogniser.start();
      } catch (e) {
        return move(STATE.FAILED, String((e && e.message) || e));
      }
      return move(STATE.LISTENING);
    },

    /** Stop listening, keeping the session open. */
    pause() {
      if (state !== STATE.LISTENING) return snapshot();
      stopUnderneath();
      return move(STATE.PAUSED);
    },

    /** Done. */
    stop() {
      if (!recogniser) return snapshot();
      stopUnderneath();
      return move(STATE.STOPPED);
    },
  });
}

/**
 * The browser's own recogniser, wrapped — where the page decides to use one.
 *
 * Nothing calls this today. It exists so that the decision, when somebody takes
 * it, is one line in the page rather than a module written under time pressure,
 * and so the adapter above is tested against the shape it would really meet.
 */
export function browserRecogniser(win) {
  const Impl = win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
  if (!Impl) return null;

  const impl = new Impl();
  impl.continuous = true;
  impl.interimResults = false;

  const wrapper = {
    start: () => impl.start(),
    stop: () => impl.stop(),
    onResult: null, onError: null, onEnd: null,
  };

  impl.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (wrapper.onResult) wrapper.onResult(result[0]?.transcript ?? "", Boolean(result.isFinal));
    }
  };
  impl.onerror = (event) => { if (wrapper.onError) wrapper.onError(event?.error ?? null); };
  impl.onend = () => { if (wrapper.onEnd) wrapper.onEnd(); };

  return wrapper;
}

/** Whether a browser could do it at all, separately from whether we do. */
export const recogniserExists = (win) =>
  Boolean(win?.SpeechRecognition || win?.webkitSpeechRecognition);
