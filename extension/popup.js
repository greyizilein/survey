const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["payload"], ({ payload }) => { if (payload) $("payload").value = payload; });

$("save").addEventListener("click", () => {
  chrome.storage.local.set({ payload: $("payload").value }, () => { $("status").textContent = "Saved."; });
});

$("fill").addEventListener("click", async () => {
  let answers;
  try { answers = JSON.parse($("payload").value); }
  catch { $("status").textContent = "Invalid JSON."; return; }
  if (!Array.isArray(answers)) { $("status").textContent = "Expected an array."; return; }
  answers = answers.flatMap((item) => Array.isArray(item.answers) ? item.answers : [item]);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("status").textContent = "Filling...";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillForm,
      args: [answers],
    });
    $("status").textContent = `Filled ${result.filled}/${result.total} fields.`;
  } catch (e) {
    $("status").textContent = "Error: " + e.message;
  }
});

async function fillForm(answers) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fields = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select'));
  const choiceGroups = Array.from(document.querySelectorAll('[role="radiogroup"], [role="group"], fieldset'));
  let filled = 0;
  const flatAnswers = answers.flatMap((item) => Array.isArray(item.answers) ? item.answers : [item]);
  const total = flatAnswers.length;

  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function textFor(el) {
    const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : "";
    return [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.name, id, el.closest('[role="listitem"], .freebirdFormviewerComponentsQuestionBaseRoot, .Qr7Oae, fieldset, label, div')?.innerText]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function scoreField(el, ans, index) {
    const question = String(ans.question || ans.text || ans.question_text || ans.question_id || "").toLowerCase();
    if (!question) return fields[index] === el ? 1 : 0;
    const label = textFor(el);
    const words = question.split(/\W+/).filter((w) => w.length > 3);
    return words.reduce((score, word) => score + (label.includes(word) ? 1 : 0), 0);
  }

  for (let i = 0; i < flatAnswers.length; i++) {
    const ans = flatAnswers[i];
    const value = String(ans.answer ?? ans.value ?? ans ?? "");
    const target = [...fields].sort((a, b) => scoreField(b, ans, i) - scoreField(a, ans, i))[0] || fields[i];
    if (!target) continue;
    const tag = target.tagName;
    const type = (target.getAttribute("type") || "").toLowerCase();
    const role = target.getAttribute("role");
    try {
      if (role === "radio" || role === "checkbox" || type === "radio" || type === "checkbox") {
        const group = target.closest('[role="radiogroup"], [role="group"], fieldset, form, body');
        const selector = role ? `[role="${role}"]` : `input[type="${type}"]`;
        const opts = group ? Array.from(group.querySelectorAll(selector)) : [target];
        const match = opts.find((o) => (o.getAttribute("aria-label") || o.value || o.parentElement?.innerText || "").toLowerCase().includes(value.toLowerCase())) || target;
        match.click();
      } else if (tag === "SELECT") {
        const opt = Array.from(target.options).find((o) => o.text.toLowerCase().includes(value.toLowerCase())) || target.options[0];
        if (opt) { target.value = opt.value; target.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        target.focus();
        setNative(target, value);
      }
      filled++;
      await sleep(120 + Math.random() * 220);
    } catch (e) {}
  }

  for (const ans of flatAnswers) {
    const value = String(ans.answer ?? ans.value ?? "").toLowerCase();
    if (!value) continue;
    const group = choiceGroups.find((g) => textFor(g).includes(String(ans.question || ans.question_id || "").toLowerCase().split(/\W+/).find((w) => w.length > 3) || "__none__"));
    const opts = group ? Array.from(group.querySelectorAll('[role="radio"], [role="checkbox"]')) : [];
    const match = opts.find((o) => (o.getAttribute("aria-label") || o.innerText || o.parentElement?.innerText || "").toLowerCase().includes(value));
    if (match) { match.click(); await sleep(80 + Math.random() * 160); }
  }

  return { filled, total };
}
