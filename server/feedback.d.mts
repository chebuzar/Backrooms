// Типи для юніт-тестів (tests/unit/feedback.test.ts); сам сервер — звичайний JavaScript.
export const KINDS: string[];
export const STATUSES: Record<string, string>;
export const TEXT_MIN: number, TEXT_MAX: number;
export function leadingZeroBits(buf: Uint8Array): number;
export function makeChallenge(bits: number, now?: number): string;
export function checkPow(challenge: unknown, nonce: unknown, used: Map<string, number>, now?: number): string | null;
export function cleanText(raw: unknown): { text?: string; error?: string };
export function textKey(text: string): string;
export function ipHash(ip: string): string;
export interface FeedbackStore { rows?: Record<string, unknown>[]; [k: string]: unknown }
export function memoryStore(): FeedbackStore;
export function pgStore(db: unknown): FeedbackStore;
export function feedbackRoutes(store: FeedbackStore): (...args: unknown[]) => Promise<boolean>;
