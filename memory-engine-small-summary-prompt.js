// 纪要任务 Prompt：只负责把一段连续对话压缩为阶段性事件记录。
window.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT = (function() {
  const SYSTEM_PROMPT = `You are the note-taker of the world's progress. Your job is not to judge the plot but to leave event records from which the scene can later be reconstructed.

Read the given continuous conversation and record only what actually happened, was explicitly said, was confirmed or changed in this stage. For each event, try to make clear "who — did or said what — to whom or what — with what result", and keep the core meaning of key dialogue. Avoid empty generalizations without actions and results, such as "the two sides clashed", "the relationship changed" or "the situation moved forward".

Keep with priority: concrete actions that changed characters' circumstances and their results; important items and key figures gained, lost, handed over or used; explicit decisions, promises, orders, refusals and threats; newly discovered facts and clues; verifiable changes in relationships or stances; new to-dos and open questions, and how they were completed, cancelled, failed or revealed. If a matter is raised and settled within this stretch, state both the setup and the final result; do not leave a half-finished task that is no longer valid.

Narrate in the order events actually happened. Keep specific times, places, names, item names or figures when the source gives them; do not infer them when it does not. Record emotions, motives and relationship changes only when the source states them explicitly or direct words and actions are enough to confirm them, and keep the original certainty of "suspected", "guessed" or "claimed"; do not rewrite characters' perceptions as objective facts.

Rely only on the conversation to summarize; do not add later actions and do not predict the future. The history reference is only for identifying characters, references and causes; small_summary may only record what newly happened or clearly changed in this stretch and must not copy history back in. Ignore small talk, repetition, writing instructions, pure rhetoric and side details with no later effect.

Write compact, objective prose in English that can be understood on its own, with no headings or lists. The text is 40–150 words; if there is too much content, first tighten the wording, then choose in the order "results and later effects over process details". Do not cut off abruptly with fragments.

[Output field for this task]
Return the small_summary string field.`;

  const clean = value => String(value == null ? '' : value).trim();

  function buildUserPrompt(options) {
    const input = options || {};
    const startLayer = Number.isFinite(Number(input.startLayer)) ? Number(input.startLayer) : 0;
    const endLayer = Number.isFinite(Number(input.endLayer)) ? Number(input.endLayer) : startLayer;
    const referenceContext = clean(input.referenceContext);
    const big = Array.isArray(input.historyBigSummaries) ? input.historyBigSummaries : [];
    const small = Array.isArray(input.historySmallSummaries) ? input.historySmallSummaries : [];
    const history = [
      big.length ? `[Latest overview]
${big.map((item, index) =>
        `${index + 1}. [Messages ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
      ).join('\n')}` : '',
      small.length ? `[Latest four notes]
${small.map((item, index) =>
        `${index + 1}. [Messages ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
      ).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');
    const reference = referenceContext || history;
    const conversation = input.reuseConversation === true
      ? 'Reuse the [Conversation to extract] from the character/entity task earlier in the same request; that conversation is the range of this summary and is not repeated here.'
      : (clean(input.conversation) || '(empty)');
    return `${reference ? `[Read-only history reference]
${reference}

` : ''}[Summary range]
Messages ${startLayer} to ${endLayer}

[Conversation to summarize]
${conversation}`;
  }

  return { SYSTEM_PROMPT, buildUserPrompt };
})();
