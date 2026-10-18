import {
  CAPABILITY, TYPE,
  bridgeSessionFromUrl, readyMessage, validateOpenMessage,
  isPieceRequirement, normaliseSavedEstimate, resultMessage, errorMessage,
} from "./src/integration/buyrflow-bridge.mjs";

let session = null;
try {
  session = bridgeSessionFromUrl(window.location.href);
} catch (error) {
  console.warn("BuyrFlow capability bridge refused the URL:", error?.message || error);
}

if (session && window.opener && window.opener !== window) {
  let caseContext = null;
  let openedAt = null;
  let banner = null;

  const post = (message) => window.opener.postMessage(message, session.returnOrigin);
  const sayError = (code, error) => post(errorMessage(session, code, error?.message || String(error || "Unknown bridge error")));

  function waitForStudio(attempt = 0) {
    if (window.BW?.loadEstimates && typeof window.go === "function") {
      post(readyMessage(session));
      return;
    }
    if (attempt >= 120) {
      sayError("engine-unavailable", new Error("BuyrWorld Should Cost Expert did not become available."));
      return;
    }
    setTimeout(() => waitForStudio(attempt + 1), 50);
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value;
  }

  function contextBanner(context) {
    document.getElementById("buyrflow-capability-context")?.remove();
    const page = document.getElementById("page-shouldcost");
    const host = page?.querySelector(".wrap") || page;
    if (!host) return null;

    const panel = document.createElement("section");
    panel.id = "buyrflow-capability-context";
    panel.className = "bw-panel";
    panel.style.marginBottom = "var(--bw-4)";
    panel.style.borderColor = "var(--bw-accent)";

    const top = document.createElement("div");
    top.className = "bw-panel-head";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Opened from BuyrFlow";
    const title = document.createElement("div");
    title.className = "bw-panel-title";
    title.textContent = `${context.ref} · ${context.title}`;
    heading.append(eyebrow, title);
    top.appendChild(heading);

    const explanation = document.createElement("p");
    explanation.style.color = "var(--bw-muted)";
    explanation.style.fontSize = "12.5px";
    explanation.style.lineHeight = "1.6";
    explanation.textContent = "Use the real Should Cost Expert below. BuyrFlow has not copied or simplified the engine. Save the build-up here when you are satisfied with it, then return that saved result to the Case.";

    const contextLine = document.createElement("p");
    contextLine.style.color = "var(--bw-body)";
    contextLine.style.fontSize = "12.5px";
    contextLine.style.lineHeight = "1.6";
    const bits = [];
    if (context.requirement.quantity) bits.push(`Quantity ${context.requirement.quantity}${context.requirement.unit ? ` ${context.requirement.unit}` : ""}`);
    if (context.requirement.spec) bits.push(`Requirement: ${context.requirement.spec}`);
    contextLine.textContent = bits.length ? bits.join(" · ") : "No structured requirement was supplied by the Case.";

    const note = document.createElement("p");
    note.style.color = "var(--bw-warning)";
    note.style.fontSize = "11.5px";
    note.style.lineHeight = "1.5";
    note.textContent = "Only an accepted-parts quantity is prefilled, and only when the Case unit is clearly pieces. Specifications, material, dimensions, rates and allowances are never guessed into Should-Cost fields.";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    const returnButton = document.createElement("button");
    returnButton.type = "button";
    returnButton.className = "bw-act bw-act-primary";
    returnButton.textContent = "Return latest saved build-up to BuyrFlow";
    const status = document.createElement("span");
    status.id = "buyrflow-capability-status";
    status.setAttribute("role", "status");
    status.style.color = "var(--bw-muted)";
    status.style.fontSize = "12px";
    status.style.alignSelf = "center";
    actions.append(returnButton, status);

    returnButton.addEventListener("click", () => {
      try {
        const estimates = [...(window.BW.loadEstimates() || [])]
          .filter((x) => x && x.savedAt && Number.isFinite(Date.parse(x.savedAt)))
          .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
        const latest = estimates.find((x) => Date.parse(x.savedAt) >= Date.parse(openedAt));
        if (!latest) throw new RangeError("Save or resave a Should-Cost build-up during this BuyrFlow session first.");
        const result = normaliseSavedEstimate(latest, { openedAt, caseContext });
        post(resultMessage(session, caseContext, result));
        status.style.color = "var(--bw-success)";
        setText(status, `${result.name} returned to ${caseContext.ref}. You can keep this Studio open or close it.`);
      } catch (error) {
        status.style.color = "var(--bw-warning)";
        setText(status, error?.message || String(error));
        sayError("result-not-ready", error);
      }
    });

    panel.append(top, explanation, contextLine, note, actions);
    host.insertBefore(panel, host.firstChild);
    return panel;
  }

  function prefillSafeContext(context) {
    if (!isPieceRequirement(context) || !context.requirement.quantity) return;
    const quantity = document.getElementById("sc-qty");
    if (!quantity || String(quantity.value || "").trim()) return;
    quantity.value = String(context.requirement.quantity);
    quantity.dispatchEvent(new Event("input", { bubbles: true }));
    quantity.dispatchEvent(new Event("change", { bubbles: true }));
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.opener || event.origin !== session.returnOrigin) return;
    try {
      const context = validateOpenMessage(event.data, session);
      if (caseContext && caseContext.id !== context.id) throw new RangeError("This bridge session is already attached to another Case.");
      caseContext = context;
      openedAt = new Date().toISOString();
      window.go("shouldcost");
      requestAnimationFrame(() => {
        banner = contextBanner(context);
        prefillSafeContext(context);
        banner?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      });
    } catch (error) {
      sayError("handoff-refused", error);
    }
  });

  waitForStudio();
}
