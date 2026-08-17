/**
 * Closed parser-provenance vocabulary for output that may be retained after a
 * dispatch failure. This module never examines raw process streams.
 */
export const OUTPUT_COMPLETENESS = Object.freeze([
  'verified-complete', 'unknown-completeness', 'no-text',
]);

export const OUTPUT_SOURCES = Object.freeze([
  'structured-envelope', 'event-stream', 'vendor-result-field', 'none',
]);

export const OUTPUT_TERMINAL_MARKERS = Object.freeze([
  'opencode-step-finish', 'opencode-message-completed', 'opencode-result-success',
  'claude-result-success', 'grok-end-turn', 'pi-agent-settled', 'none',
]);

const CONTROL_BYTES = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * @returns {{completeness: 'no-text', source: 'none', terminalMarker: 'none'}}
 */
export function noTextOutputEvidence() {
  return { completeness: 'no-text', source: 'none', terminalMarker: 'none' };
}

function hasParserText(text) {
  return typeof text === 'string' && text.replace(CONTROL_BYTES, '').trim().length > 0;
}

/**
 * Validate a parser-owned provenance declaration and return only its closed
 * public shape. Extra candidate properties are intentionally discarded.
 *
 * @param {string} text parser-designated answer text
 * @param {unknown} candidate parser-declared provenance
 * @returns {{completeness: string, source: string, terminalMarker: string}|null}
 */
export function validateOutputEvidence(text, candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const { completeness, source, terminalMarker } = candidate;
  if (!OUTPUT_COMPLETENESS.includes(completeness)
    || !OUTPUT_SOURCES.includes(source)
    || !OUTPUT_TERMINAL_MARKERS.includes(terminalMarker)) {
    return null;
  }

  const hasText = hasParserText(text);
  if (completeness === 'no-text') {
    if (hasText || source !== 'none' || terminalMarker !== 'none') return null;
  } else {
    if (!hasText || source === 'none') return null;
    if (completeness === 'verified-complete' && terminalMarker === 'none') return null;
    if (completeness === 'unknown-completeness' && terminalMarker !== 'none') return null;
  }

  return { completeness, source, terminalMarker };
}

/**
 * Select parser-designated text eligible for terminal persistence. A failure
 * may retain only a validated parser declaration; success keeps legacy text
 * compatibility but is never represented as recovered output.
 *
 * @param {{adapterStatus?: string, parsed?: {text?: unknown, outputEvidence?: unknown}, stdinDeliveryError?: boolean, parserFailed?: boolean, invalidTaskOutput?: boolean}} input
 * @returns {{text: string, outputEvidence: {completeness: string, source: string, terminalMarker: string}, recoveredOutput: boolean}}
 */
export function selectTerminalOutput({
  adapterStatus,
  parsed,
  stdinDeliveryError = false,
  parserFailed = false,
  invalidTaskOutput = false,
} = {}) {
  const noText = () => ({ text: '', outputEvidence: noTextOutputEvidence(), recoveredOutput: false });
  if (stdinDeliveryError || parserFailed || invalidTaskOutput) return noText();

  const text = typeof parsed?.text === 'string' ? parsed.text : '';
  if (!hasParserText(text)) return noText();

  const evidence = validateOutputEvidence(text, parsed?.outputEvidence);
  if (adapterStatus === 'success') {
    return {
      text,
      outputEvidence: evidence || noTextOutputEvidence(),
      recoveredOutput: false,
    };
  }

  if (!evidence || evidence.completeness === 'no-text') return noText();
  return { text, outputEvidence: evidence, recoveredOutput: true };
}
