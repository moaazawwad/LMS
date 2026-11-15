import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  /** one short sentence: what happened, or why it did not */
  text: string;
  /** an optional next step, e.g. "Book the makeup" */
  link?: { label: string; url: string; queryParams?: Record<string, string> };
}

/** How long a message stays: done goes quickly, a failure stays longer. */
const STAY_MS: Record<ToastKind, number> = { success: 4000, error: 9000 };
/** A page's own wording replaces the generic one shown for the same action. */
const REPLACE_WITHIN_MS = 2500;
const MAX = 3;

/**
 * The messages shown at the top of the screen after every action:
 * green "Done" when it worked, red "Not done" with the reason when it failed.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  /** Counts the actions that worked, so a page's activity can show the new entry. */
  readonly actionsDone = signal(0);
  private next = 1;
  private lastSuccess: { id: number; at: number } | null = null;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(text: string, link?: Toast['link']) {
    this.actionsDone.update((n) => n + 1);
    // The page says it better than the generic message: swap the words, keep one box.
    const last = this.lastSuccess;
    if (last && Date.now() - last.at < REPLACE_WITHIN_MS && this.find(last.id)) {
      this.toasts.update((list) =>
        list.map((t) => (t.id === last.id ? { ...t, text, link: link ?? t.link } : t)),
      );
      this.schedule(last.id, STAY_MS.success);
      return;
    }
    const id = this.push('success', text, link);
    this.lastSuccess = { id, at: Date.now() };
  }

  error(text: string) {
    // The same failure twice in a row shows once.
    const same = this.toasts().find((t) => t.kind === 'error' && t.text === text);
    if (same) {
      this.schedule(same.id, STAY_MS.error);
      return;
    }
    this.push('error', text);
  }

  dismiss(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Keep a message while the pointer or focus is on it. */
  hold(id: number) {
    clearTimeout(this.timers.get(id));
  }

  release(id: number) {
    const t = this.find(id);
    if (t) this.schedule(id, STAY_MS[t.kind] / 2);
  }

  private find(id: number) {
    return this.toasts().find((t) => t.id === id);
  }

  private push(kind: ToastKind, text: string, link?: Toast['link']) {
    const id = this.next++;
    this.toasts.update((list) => [...list, { id, kind, text, link }].slice(-MAX));
    this.schedule(id, STAY_MS[kind]);
    return id;
  }

  private schedule(id: number, ms: number) {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ms),
    );
  }
}
