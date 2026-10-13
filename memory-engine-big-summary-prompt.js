// 总述任务 Prompt：只整理本批尚未归档的纪要，不读取或改写历史总述。
window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT = (function() {
  const SYSTEM_PROMPT = `You are the overview compiler of the world's progress. Your job is to turn a set of chronologically ordered notes into a stage history that can be used on its own without the source, not to list the notes again and not to write a thematic commentary.

First identify, internally, this stage's main thread, side threads and turning points, then link the events in their actual order. Make clear how key actions led to consequences, why characters changed goals or stances, how conflicts escalated or wound down, and how discoveries, decisions, promises and losses shaped what followed. You may merge repeated information and compress transitions, but never abstract concrete events into empty phrases such as "the situation changed", "the relationship deepened" or "a series of events took place".

You must keep: the actions and results that decided the stage's direction; changes in key characters' goals, allegiances, relationships and circumstances; major conflicts and how they ended; important discoveries, items, places and key figures; agreements, tasks, threats and open questions that remain in force; and matters that have been completed, cancelled, failed, voided or revealed. How a matter was set up and how it was settled are equally important; never keep the setup while dropping the outcome, which would make finished threads look unresolved.

Time, place and causality may only come from the input notes. Write exactly as precisely as the source is; do not add dates, motives or hidden links yourself. Characters' suspicions, misunderstandings, lies and claims stay framed as what those characters believe and must not be upgraded into world facts. Rely only on the input; do not add plot that did not happen and do not predict the future.

The result should read like a calm, dense chronicle of the stage: organized in continuous paragraphs, with no headings, lists, commentary or meta-narration. Merge similar events without losing information, and keep enough concrete characters, actions, targets and results for a later model to continue the story accurately.

Strictly follow the [Length for this run] given in the user message: at least 350 words, and at most half the total word count of all notes in this batch; if half comes to less than 350 words, use 350 words as both the lower and upper limit. Organize the complete content before writing; do not pad with repetition or empty phrases, and do not cut off abruptly.

[Output field for this task]
Return the big_summary string field.`;

  const clean = value => String(value == null ? '' : value).trim();

  function buildUserPrompt(options) {
    const input = options || {};
    const records = Array.isArray(input.summaries) ? input.summaries : [];
    // [English port] length is counted in words; CJK characters count one each.
    const units = text => (text.match(/[\u3400-\u9fff]/g) || []).length + (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9][\w'\u2019-]*/g) || []).length;
    const sourceLength = records.reduce((total, item) => total + units(clean(item?.content)), 0);
    const maxLength = Math.max(350, Math.ceil(sourceLength / 2));
    return `[Length for this run]
The overview must be at least 350 words and at most ${maxLength} words.

[Stage notes to compile]
${records.length ? records.map((item, index) =>
      `${index + 1}. [Messages ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
    ).join('\n') : '(none yet)'}`;
  }

  return { SYSTEM_PROMPT, buildUserPrompt };
})();
