function collectPrefixedLines(transcript, prefix) {
  return transcript
    .split(/\r?\n|[。.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((line) => line.slice(prefix.length).replace(/^[:：]\s*/, "").trim())
    .filter(Boolean);
}

export function parseTranscript(transcript) {
  const normalized = transcript.trim().replace(/\s+/g, " ");
  const todos = collectPrefixedLines(transcript, "TODO");
  const decisions = collectPrefixedLines(transcript, "Decision");
  const openQuestions = collectPrefixedLines(transcript, "Question");
  const ideas = collectPrefixedLines(transcript, "Idea");
  const waiting = collectPrefixedLines(transcript, "Waiting");

  return {
    summary: normalized.slice(0, 220) || "Recording processed with no transcript text.",
    my_todos: todos.length ? todos : ["Review generated transcript"],
    waiting_for_others: waiting,
    decisions,
    open_questions: openQuestions,
    ideas
  };
}
