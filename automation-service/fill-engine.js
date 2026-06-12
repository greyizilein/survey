// Browser-side fill engine, injected into the target page via page.evaluate.
// Keep this in sync with extension/content.js and src/lib/fill-script.ts.
export async function fillEngine(answers) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flat = answers.flatMap((item) => Array.isArray(item.answers) ? item.answers : [item]);

  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function textFor(el) {
    const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "" : "";
    const container = el.closest('[role="listitem"], .freebirdFormviewerComponentsQuestionBaseRoot, fieldset, label, div');
    return [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.name, id, container?.textContent]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function questionWords(ans) {
    const question = String(ans.question || ans.text || ans.question_text || ans.question_id || "").toLowerCase();
    return question.split(/\W+/).filter((w) => w.length > 3);
  }

  async function fillCurrentPage() {
    let filled = 0;
    const used = new WeakSet();

    const radioGroups = Array.from(document.querySelectorAll('[role="radiogroup"]'));
    for (const ans of flat) {
      const value = String(ans.answer ?? ans.value ?? "").toLowerCase();
      if (!value) continue;
      const words = questionWords(ans);
      const group = radioGroups
        .filter((g) => !used.has(g))
        .sort((a, b) => {
          const score = (g) => words.reduce((s, w) => s + (textFor(g).includes(w) ? 1 : 0), 0);
          return score(b) - score(a);
        })[0];
      if (!group) continue;
      const score = words.reduce((s, w) => s + (textFor(group).includes(w) ? 1 : 0), 0);
      if (score === 0 && words.length > 0) continue;
      const opts = Array.from(group.querySelectorAll('[role="radio"]'));
      const match = opts.find((o) => (o.getAttribute("aria-label") || o.getAttribute("data-value") || o.textContent || "").toLowerCase().includes(value))
        || opts.find((o, i) => String(i + 1) === value.trim());
      if (match) {
        match.scrollIntoView({ block: "center" });
        match.click();
        used.add(group);
        filled++;
        await sleep(120 + Math.random() * 200);
      }
    }

    const checkboxContainers = Array.from(document.querySelectorAll('[role="list"], [role="group"]'))
      .filter((c) => c.querySelectorAll('[role="checkbox"]').length > 0);
    for (const ans of flat) {
      const raw = String(ans.answer ?? ans.value ?? "");
      if (!raw) continue;
      const values = raw.split(/,|;| and |\n/i).map((v) => v.trim().toLowerCase()).filter(Boolean);
      if (values.length === 0) continue;
      const words = questionWords(ans);
      const container = checkboxContainers
        .filter((c) => !used.has(c))
        .sort((a, b) => {
          const score = (c) => words.reduce((s, w) => s + (textFor(c).includes(w) ? 1 : 0), 0);
          return score(b) - score(a);
        })[0];
      if (!container) continue;
      const score = words.reduce((s, w) => s + (textFor(container).includes(w) ? 1 : 0), 0);
      if (score === 0 && words.length > 0) continue;
      const boxes = Array.from(container.querySelectorAll('[role="checkbox"]'));
      let matchedAny = false;
      for (const value of values) {
        const box = boxes.find((o) => (o.getAttribute("aria-label") || o.getAttribute("data-answer-value") || o.textContent || "").toLowerCase().includes(value));
        if (box && box.getAttribute("aria-checked") !== "true") {
          box.scrollIntoView({ block: "center" });
          box.click();
          matchedAny = true;
          await sleep(100 + Math.random() * 180);
        }
      }
      if (matchedAny) { used.add(container); filled++; }
    }

    const fields = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea, select'));
    for (const ans of flat) {
      const value = String(ans.answer ?? ans.value ?? "");
      if (!value) continue;
      const words = questionWords(ans);
      const target = fields
        .filter((el) => !used.has(el))
        .sort((a, b) => {
          const score = (el) => words.reduce((s, w) => s + (textFor(el).includes(w) ? 1 : 0), 0);
          return score(b) - score(a);
        })[0];
      if (!target) continue;
      const score = words.reduce((s, w) => s + (textFor(target).includes(w) ? 1 : 0), 0);
      if (score === 0 && words.length > 0) continue;
      if (target.tagName === "SELECT") {
        const opt = Array.from(target.options).find((o) => o.text.toLowerCase().includes(value.toLowerCase()));
        if (opt) { target.value = opt.value; target.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        target.focus();
        setNative(target, value);
      }
      used.add(target);
      filled++;
      await sleep(150 + Math.random() * 250);
    }

    return filled;
  }

  function findButton(label) {
    const candidates = Array.from(document.querySelectorAll('[role="button"], button'));
    return candidates.find((b) => b.textContent?.trim().toLowerCase().includes(label));
  }

  let totalFilled = 0;
  for (let page = 0; page < 30; page++) {
    await sleep(800);
    totalFilled += await fillCurrentPage();
    await sleep(400);
    const nextBtn = findButton("next");
    const submitBtn = findButton("submit");
    if (submitBtn) {
      submitBtn.scrollIntoView({ block: "center" });
      await sleep(300);
      submitBtn.click();
      await sleep(1500);
      return { filled: totalFilled, submitted: true, pages: page + 1 };
    }
    if (nextBtn) {
      nextBtn.scrollIntoView({ block: "center" });
      await sleep(300);
      nextBtn.click();
    } else {
      break;
    }
  }
  return { filled: totalFilled, submitted: false, pages: 30 };
}
