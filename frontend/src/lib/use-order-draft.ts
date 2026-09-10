"use client";

import { uuid } from "@/lib/uuid";
import { RefObject, useCallback, useEffect, useRef } from "react";

import { saveOrderDraft } from "@/lib/storefront-api";

const DRAFT_KEY_STORAGE = "nb_order_draft_key";
/** Quiet period after the last keystroke before a draft is sent. */
const AUTOSAVE_DELAY_MS = 1200;
/** Matches DRAFT_MIN_PHONE_DIGITS on the API: below this there is no lead. */
const MIN_PHONE_DIGITS = 6;
/** How long to stop autosaving after the API answers 429. */
const THROTTLE_PAUSE_MS = 60_000;

type DraftFields = {
  customerName: string;
  phone: string;
  address: string;
};

/** One key per visit, so every autosave from this tab updates a single row. */
function draftKey(): string {
  try {
    const existing = sessionStorage.getItem(DRAFT_KEY_STORAGE);
    if (existing) return existing;
    const key = uuid();
    sessionStorage.setItem(DRAFT_KEY_STORAGE, key);
    return key;
  } catch {
    // Private mode or storage blocked: a per-mount key still de-duplicates
    // this visit's own autosaves.
    return uuid();
  }
}

/**
 * Capture the order form even when it is never submitted.
 *
 * The form is autosaved once it holds a phone number we could call back on,
 * and flushed when the page is hidden or closed — the moment an abandoned
 * form would otherwise be lost. Submitting stops the autosave for good: the
 * API promotes that same row to a real order, so a customer is never in both
 * the Incomplete and Web Order Lists tables.
 */
export function useOrderDraft(formRef: RefObject<HTMLFormElement | null>) {
  const keyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const submittedRef = useRef(false);
  const pausedUntilRef = useRef(0);

  const readForm = useCallback((): DraftFields | null => {
    const form = formRef.current;
    if (!form) return null;
    const data = new FormData(form);
    return {
      customerName: String(data.get("name") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      address: String(data.get("address") ?? "").trim(),
    };
  }, [formRef]);

  const save = useCallback(() => {
    if (submittedRef.current) return;
    if (Date.now() < pausedUntilRef.current) return;
    const fields = readForm();
    if (!fields) return;
    if (fields.phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return;

    // Nothing new since the last save — don't spend a request on it.
    const fingerprint = JSON.stringify(fields);
    if (fingerprint === lastSavedRef.current) return;
    lastSavedRef.current = fingerprint;

    if (!keyRef.current) keyRef.current = draftKey();
    void saveOrderDraft({ draftKey: keyRef.current, ...fields }).then((result) => {
      if (result === "throttled") {
        // Back off, and forget this fingerprint so the draft is retried once
        // the pause is over rather than considered already saved.
        pausedUntilRef.current = Date.now() + THROTTLE_PAUSE_MS;
        lastSavedRef.current = null;
      }
    });
  }, [readForm]);

  const scheduleSave = useCallback(() => {
    if (submittedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_DELAY_MS);
  }, [save]);

  /** Send straight away, skipping the debounce. */
  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    save();
  }, [save]);

  // Leaving the page is the whole point of this: catch it before it's gone.
  // pagehide covers closing and mobile back/forward; visibilitychange covers
  // switching apps or tabs, which on iOS is the last event we reliably get.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "visible") return;
      flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flush]);

  return {
    /** Draft key to send with the order, so the API promotes this same row. */
    getDraftKey: () => keyRef.current ?? undefined,
    /** Typing, pasting, or the browser autofilling a field. */
    onFormInput: scheduleSave,
    /** Leaving a field: save what it holds without waiting out the debounce. */
    onFieldBlur: flush,
    /** A fresh form after a completed order (ordering for someone else):
     * capture may resume, under a new key so it can't touch the first order. */
    restart: () => {
      submittedRef.current = false;
      lastSavedRef.current = null;
      keyRef.current = null;
    },
    /** The order went through; this visit must never write a draft again. */
    stop: () => {
      submittedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        sessionStorage.removeItem(DRAFT_KEY_STORAGE);
      } catch {
        // Nothing to clean up when storage was unavailable to begin with.
      }
    },
  };
}
