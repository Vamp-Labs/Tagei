// PIX fallback templates (owned by A4). Pure and deterministic: the server uses them
// whenever the LLM is off, over budget, slow or filtered, and the web client can use
// them offline with the same copy.

export * from './format.ts';
export * from './labels.ts';
export * from './debrief.ts';
export * from './insight.ts';
export * from './chat.ts';

export const TEMPLATE_VERSION = 1;
