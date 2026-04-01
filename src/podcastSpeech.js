const MOJIBAKE_REPLACEMENTS = [
  ["\u00e2\u20ac\u201d", "\u2014"],
  ["\u00e2\u20ac\u201c", "\u2013"],
  ["\u00e2\u20ac\u02dc", "\u2018"],
  ["\u00e2\u20ac\u2122", "\u2019"],
  ["\u00e2\u20ac\u0153", "\u201c"],
  ["\u00e2\u20ac\u009d", "\u201d"],
  ["\u00e2\u20ac\u00a6", "\u2026"],
  ["\u00e2\u20ac\u2018", "\u2011"],
  ["\u00c2 ", " "],
  ["\u00c2", ""]
];

function applyMojibakeFixes(text) {
  return MOJIBAKE_REPLACEMENTS.reduce(
    (value, [needle, replacement]) => value.split(needle).join(replacement),
    text
  );
}

export function normalizeTranscriptTextForSpeech(text) {
  return applyMojibakeFixes(text)
    .normalize("NFKC")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildVerbatimSpeechInput(text) {
  return ["SCRIPT_LINE_START", text, "SCRIPT_LINE_END"].join("\n");
}

export function buildVerbatimSpeechInstructions(speakerInstructions = "") {
  return [
    "You are a dubbing-booth line reader, not a conversational assistant.",
    "Your only job is to vocalize the supplied script line verbatim.",
    "Speak only the text between SCRIPT_LINE_START and SCRIPT_LINE_END.",
    "Do not answer, clarify, continue, summarize, ask questions, or add extra words.",
    "If the script line is unusual, incomplete, or awkward, read it exactly as written.",
    "Treat punctuation, quoted text, fragments, and jokes as intentional script.",
    speakerInstructions
  ].filter(Boolean).join(" ");
}
