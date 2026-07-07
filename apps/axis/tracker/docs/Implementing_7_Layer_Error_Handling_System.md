**Implementing a 7-Layer Error Handling System**

**in a React + Monday SDK Application**

*A step-by-step integration guide for production-grade error handling*

Technical Integration Guide

*Target audience: senior and mid-level React developers*

**Contents**

1\. Overview 3

2\. Prerequisites 4

3\. Step-by-step integration guide 5

4\. The boot order 25

5\. The folder structure 27

6\. UX rules cheat sheet 29

7\. Monday SDK-specific gotchas 31

8\. Testing checklist 33

**1. Overview**

This guide describes a comprehensive, production-grade error handling
architecture for client-side React applications that integrate with the
Monday.com SDK. The system is organized into seven distinct layers, each
addressing a specific class of failure that any non-trivial Monday app
will encounter in real-world conditions.

**What the system is**

The architecture follows a single principle: every possible failure mode
has a known location in the codebase where it is caught, handled, and
translated into a user-facing message. No error is allowed to silently
disappear, crash the application, or leave the user staring at a blank
screen. The seven layers are layered defensively, meaning each one acts
as a safety net for the layer above it; the global handler catches what
slipped through everything else.

- Layer 1: React rendering errors — component crashes, broken JSX, bad
  props, null-reference during render

- Layer 2: API errors — Monday API calls failing with HTTP 4xx, 5xx,
  rate limits, auth errors, malformed responses

- Layer 3: Network issues and slow loading — offline detection,
  timeouts, slow connections, partial responses

- Layer 4: Race conditions — stale state updates, multiple async
  operations competing, unmounted component setState

- Layer 5: Unhandled errors — uncaught exceptions and unhandled promise
  rejections, the safety net

- Layer 6: Client-side validation errors — bad user input caught before
  any API call is made

- Layer 7: Monday SDK errors — SDK initialization failures, wrong
  context, missing permissions, SDK method failures

**Why it matters**

Client-side errors in a Monday.com app have an unusual characteristic:
the application is embedded inside another application. A crash does not
just affect your widget — it leaves the user staring at a broken iframe
inside their Monday board, with no clear way to report or recover from
the issue. The blast radius of an unhandled error is therefore larger
than in a standalone web app, and the user's confidence in your app is
more fragile.

On top of that, the Monday SDK has failure modes that have no analogue
in regular web development. The SDK can fail to initialize without
throwing. The app can be rendered outside of Monday entirely (in dev, in
tests, or by a misconfigured webhook). Permissions can change
mid-session. Rate limits are aggressive. A well-architected error
handling system anticipates all of these and produces a calm, actionable
user experience instead of a cascade of failures.

**The core UX contract**

Three rules govern every error that reaches the user. These are
non-negotiable, and every layer of the system is designed to uphold
them.

- **No blank screens. If something fails, the user sees a styled
  fallback UI explaining what went wrong, never an empty viewport.**

- **No silent crashes. Every error is logged, reported to monitoring,
  and surfaced to the user in some form — even if only a small toast.**

- **Always actionable. Every error message tells the user what they can
  do next: retry, reload, contact support, fix their input, grant a
  permission.**

> **Design rule:** If you can ever imagine a user clicking around your
> app and not understanding why something is broken or what to do about
> it, the error handling has failed. Every error path must terminate in
> a state where the user knows what happened and what to do.

**2. Prerequisites**

Before retrofitting the error handling system into your existing app,
install the required dependencies and verify your project meets the
assumed baseline.

**Required npm packages**

Install the following packages. Versions shown are minimum compatible
versions; later patch and minor versions are fine.

> npm install zod@^3.22.0 \\
>
> react-hook-form@^7.49.0 \\
>
> @hookform/resolvers@^3.3.0 \\
>
> monday-sdk-js@^0.5.0

Each package has a specific role:

zod — schema validation library. Defines the shape of form data,
validates user input, and infers TypeScript types from a single source
of truth.

react-hook-form — form state management. Handles field registration,
validation triggers, error state, and submit handling without
re-rendering the entire form on every keystroke.

@hookform/resolvers — bridges Zod schemas to react-hook-form, so a
single Zod schema drives both validation and TypeScript types.

monday-sdk-js — the official Monday.com SDK. Required for any
communication with the Monday platform from inside an embedded app.

**Assumed baseline**

The guide assumes the following are already in place in your project:

- React 18 or later, with the new createRoot API in use

- TypeScript (strongly recommended; the guide uses TypeScript
  throughout)

- A bundler such as Vite, webpack, or Next.js

- An existing entry point file (typically main.tsx or index.tsx)

- The Monday SDK initialized somewhere, even if only with a basic
  monday.init() call

**Optional but recommended**

An external error reporting service such as Sentry, Datadog, or
LogRocket. The guide includes a reporter abstraction that can route to
any of these; a service is not strictly required, but without one your
production errors will only appear in user-side console logs and you
will lose the ability to diagnose them after the fact.

**3. Step-by-step integration guide**

The seven layers are presented in the recommended order of
implementation. Each layer is independently useful, but later layers
depend on earlier ones (the global error reporter, for example, is used
by every other layer). Implement them in order, verify each works in
isolation, and only then move to the next.

For each layer the guide covers: what to create, where it goes in the
folder structure, the code to write, and how to wire it into your
existing app.

**3.1 Layer 1 — React rendering errors**

Goal: catch any error thrown during React rendering — bad JSX, null
reference, type error, broken hook order — and replace the broken
subtree with a styled fallback UI.

**What to create**

- An ErrorBoundary class component

- A default fallback UI component

- A per-widget fallback that preserves the rest of the page

**Where it goes**

Create the file at src/components/errors/ErrorBoundary.tsx. Group it
with other error UI components.

**Code**

> // src/components/errors/ErrorBoundary.tsx
>
> import React, { Component, ReactNode } from 'react';
>
> import { reportError } from '../../lib/reporter';
>
> interface FallbackProps {
>
> error: Error;
>
> reset: () =\> void;
>
> }
>
> interface Props {
>
> children: ReactNode;
>
> fallback?: (props: FallbackProps) =\> ReactNode;
>
> onError?: (error: Error, info: React.ErrorInfo) =\> void;
>
> }
>
> interface State {
>
> error: Error \| null;
>
> }
>
> export class ErrorBoundary extends Component\<Props, State\> {
>
> state: State = { error: null };
>
> static getDerivedStateFromError(error: Error): State {
>
> return { error };
>
> }
>
> componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
>
> this.props.onError?.(error, errorInfo);
>
> reportError(error, { errorInfo, context: 'react-render' });
>
> }
>
> reset = () =\> this.setState({ error: null });
>
> render() {
>
> const { error } = this.state;
>
> if (error) {
>
> return this.props.fallback
>
> ? this.props.fallback({ error, reset: this.reset })
>
> : \<DefaultErrorFallback error={error} reset={this.reset} /\>;
>
> }
>
> return this.props.children;
>
> }
>
> }
>
> function DefaultErrorFallback({ error, reset }: FallbackProps) {
>
> return (
>
> \<div role="alert" style={{ padding: 24, textAlign: 'center' }}\>
>
> \<h2\>Something went wrong\</h2\>
>
> \<p\>{error.message}\</p\>
>
> \<button onClick={reset}\>Try again\</button\>
>
> \</div\>
>
> );
>
> }

**How to wire it in**

Use two tiers of boundary. A root-level boundary wraps the entire
application; per-widget boundaries wrap each independently-mounted
Monday widget so that one broken widget does not take down the rest of
the page.

> // In your App.tsx
>
> \<ErrorBoundary fallback={AppCrashFallback}\>
>
> \<Router\>
>
> \<Route path="/board" element={
>
> \<ErrorBoundary fallback={WidgetErrorFallback}\>
>
> \<BoardWidget /\>
>
> \</ErrorBoundary\>
>
> } /\>
>
> \</Router\>
>
> \</ErrorBoundary\>
>
> **Important:** ErrorBoundary only catches errors in rendering,
> lifecycle methods, and the constructor. It does NOT catch errors in
> event handlers, async code, setTimeout callbacks, or server-side
> rendering. Those are handled by Layers 2 through 5.

**3.2 Layer 2 — API errors**

Goal: every call to the Monday API is wrapped in a typed error pipeline.
HTTP status codes are mapped to subclasses, retryable errors trigger
exponential backoff, rate limits respect the server's retry-after
header, and the calling code never has to parse error strings.

**What to create**

- A typed error class hierarchy in src/errors/

- A wrapper function around monday.api() that handles retry, backoff,
  and error classification

- A useApi hook that gives components a clean loading/error/data triple

- A user-facing error message map

**Where it goes**

- Error classes: src/errors/MondayApiError.ts

- API wrapper: src/lib/mondayClient.ts

- Hook: src/hooks/useApi.ts

**Error class hierarchy**

> // src/errors/MondayApiError.ts
>
> export class MondayApiError extends Error {
>
> constructor(
>
> public code: string,
>
> public status: number,
>
> message: string,
>
> public retryable: boolean,
>
> public fieldErrors?: Array\<{ field: string; message: string }\>
>
> ) {
>
> super(message);
>
> this.name = 'MondayApiError';
>
> }
>
> }
>
> export class AuthError extends MondayApiError {
>
> constructor(message = 'Authentication failed') {
>
> super('UNAUTHORIZED', 401, message, false);
>
> this.name = 'AuthError';
>
> }
>
> }
>
> export class RateLimitError extends MondayApiError {
>
> constructor(public retryAfterMs: number) {
>
> super('RATE_LIMITED', 429, 'Rate limit exceeded', true);
>
> this.name = 'RateLimitError';
>
> }
>
> }
>
> export class NotFoundError extends MondayApiError {
>
> constructor(message = 'Resource not found') {
>
> super('NOT_FOUND', 404, message, false);
>
> this.name = 'NotFoundError';
>
> }
>
> }
>
> export class MalformedResponseError extends MondayApiError {
>
> constructor(message = 'Malformed API response') {
>
> super('MALFORMED', 200, message, false);
>
> this.name = 'MalformedResponseError';
>
> }
>
> }

**The wrapper with retry and backoff**

> // src/lib/mondayClient.ts
>
> import monday from 'monday-sdk-js';
>
> import {
>
> MondayApiError, AuthError, RateLimitError,
>
> NotFoundError, MalformedResponseError,
>
> } from '../errors/MondayApiError';
>
> const MAX_RETRIES = 3;
>
> const BASE_DELAY_MS = 500;
>
> const sleep = (ms: number) =\> new Promise(r =\> setTimeout(r, ms));
>
> export async function mondayApiCall\<T\>(
>
> query: string,
>
> variables?: Record\<string, unknown\>,
>
> attempt = 0
>
> ): Promise\<T\> {
>
> try {
>
> const res = await monday.api(query, { variables });
>
> if (res?.errors?.length) {
>
> const err = res.errors\[0\];
>
> const code = err.extensions?.code;
>
> if (code === 'UNAUTHORIZED') throw new AuthError(err.message);
>
> if (code === 'RATE_LIMITED')
>
> throw new RateLimitError(err.extensions?.retryAfterMs ?? 5000);
>
> if (code === 'NOT_FOUND') throw new NotFoundError(err.message);
>
> throw new MondayApiError(
>
> code ?? 'UNKNOWN',
>
> 400,
>
> err.message,
>
> false
>
> );
>
> }
>
> if (!res?.data) {
>
> throw new MalformedResponseError();
>
> }
>
> return res.data as T;
>
> } catch (err) {
>
> if (err instanceof RateLimitError && attempt \< MAX_RETRIES) {
>
> await sleep(err.retryAfterMs);
>
> return mondayApiCall\<T\>(query, variables, attempt + 1);
>
> }
>
> if (err instanceof MondayApiError && err.retryable && attempt \<
> MAX_RETRIES) {
>
> await sleep(BASE_DELAY_MS \* Math.pow(2, attempt));
>
> return mondayApiCall\<T\>(query, variables, attempt + 1);
>
> }
>
> if (err instanceof AuthError) {
>
> try { await monday.oauth(); } catch { }
>
> }
>
> throw err;
>
> }
>
> }

**The useApi hook**

> // src/hooks/useApi.ts
>
> import { useState, useEffect, useCallback } from 'react';
>
> import { mondayApiCall } from '../lib/mondayClient';
>
> import { MondayApiError } from '../errors/MondayApiError';
>
> interface State\<T\> {
>
> data: T \| null;
>
> loading: boolean;
>
> error: MondayApiError \| null;
>
> }
>
> export function useApi\<T\>(query: string, variables?: Record\<string,
> unknown\>) {
>
> const \[state, setState\] = useState\<State\<T\>\>({
>
> data: null,
>
> loading: true,
>
> error: null,
>
> });
>
> const execute = useCallback(async () =\> {
>
> setState(s =\> ({ ...s, loading: true, error: null }));
>
> try {
>
> const data = await mondayApiCall\<T\>(query, variables);
>
> setState({ data, loading: false, error: null });
>
> } catch (err) {
>
> setState({ data: null, loading: false, error: err as MondayApiError
> });
>
> }
>
> }, \[query, JSON.stringify(variables)\]);
>
> useEffect(() =\> { execute(); }, \[execute\]);
>
> return { ...state, retry: execute };
>
> }

**User-facing message map**

Never expose raw API messages. Map every code to a friendly, actionable
line.

> // src/lib/errorMessages.ts
>
> export const USER_MESSAGES: Record\<string, string\> = {
>
> UNAUTHORIZED: 'Your session has expired. Reconnecting…',
>
> RATE_LIMITED: 'Too many requests. Retrying automatically…',
>
> NOT_FOUND: 'This item no longer exists in Monday.com.',
>
> MALFORMED: 'Received an unexpected response. Please retry.',
>
> TIMEOUT: 'The request took too long. Check your connection.',
>
> UNKNOWN: 'Something went wrong. Try again or refresh.',
>
> };

**3.3 Layer 3 — Network and slow loading**

Goal: handle the conditions that exist between your code and the Monday
servers. Detect offline state before firing requests, time out hung
requests, and surface slow connections to the user without leaving them
staring at a spinner forever.

**What to create**

- A withTimeout utility for racing any promise against a deadline

- A useNetworkStatus hook for offline detection

- A SlowLoadingWrapper component for progressive loading feedback

- A network status banner shown when the user goes offline

**Where it goes**

- Timeout utility: src/lib/withTimeout.ts

- Network hook: src/hooks/useNetworkStatus.ts

- Banner component: src/components/errors/NetworkStatusBanner.tsx

**withTimeout utility**

> // src/lib/withTimeout.ts
>
> import { MondayApiError } from '../errors/MondayApiError';
>
> export async function withTimeout\<T\>(
>
> promise: Promise\<T\>,
>
> ms = 10_000
>
> ): Promise\<T\> {
>
> let timer: ReturnType\<typeof setTimeout\> \| undefined;
>
> const timeout = new Promise\<never\>((\_, reject) =\> {
>
> timer = setTimeout(
>
> () =\> reject(new MondayApiError('TIMEOUT', 0, 'Request timed out',
> true)),
>
> ms
>
> );
>
> });
>
> try {
>
> return await Promise.race(\[promise, timeout\]);
>
> } finally {
>
> if (timer) clearTimeout(timer);
>
> }
>
> }

**Network status hook**

> // src/hooks/useNetworkStatus.ts
>
> import { useState, useEffect } from 'react';
>
> export function useNetworkStatus() {
>
> const \[online, setOnline\] = useState(navigator.onLine);
>
> useEffect(() =\> {
>
> const on = () =\> setOnline(true);
>
> const off = () =\> setOnline(false);
>
> window.addEventListener('online', on);
>
> window.addEventListener('offline', off);
>
> return () =\> {
>
> window.removeEventListener('online', on);
>
> window.removeEventListener('offline', off);
>
> };
>
> }, \[\]);
>
> return online;
>
> }

**Progressive loading wrapper**

A two-stage indicator: a skeleton at 0ms, a Still loading message at 3
seconds, and an alarming Taking longer than usual notice at 10 seconds.

> // src/components/errors/SlowLoadingWrapper.tsx
>
> import { useState, useEffect } from 'react';
>
> interface Props {
>
> loading: boolean;
>
> onCancel?: () =\> void;
>
> }
>
> export function SlowLoadingWrapper({ loading, onCancel }: Props) {
>
> const \[stage, setStage\] = useState(0);
>
> useEffect(() =\> {
>
> if (!loading) {
>
> setStage(0);
>
> return;
>
> }
>
> const t1 = setTimeout(() =\> setStage(1), 3000);
>
> const t2 = setTimeout(() =\> setStage(2), 10_000);
>
> return () =\> {
>
> clearTimeout(t1);
>
> clearTimeout(t2);
>
> };
>
> }, \[loading\]);
>
> if (stage === 0) return null;
>
> if (stage === 1) return \<p\>Still loading…\</p\>;
>
> return (
>
> \<div\>
>
> \<p\>Taking longer than usual.\</p\>
>
> {onCancel && \<button onClick={onCancel}\>Cancel\</button\>}
>
> \</div\>
>
> );
>
> }

**How to wire it in**

Wrap your existing API call layer in withTimeout. Mount the offline
banner near the top of your component tree, ideally inside the SDK
provider but outside the router.

> // Inside mondayApiCall, wrap the SDK call:
>
> const res = await withTimeout(monday.api(query, { variables }),
> 10_000);
>
> // At the app root:
>
> \<NetworkStatusBanner\>
>
> \<App /\>
>
> \</NetworkStatusBanner\>

**3.4 Layer 4 — Race conditions**

Goal: prevent the three classic async pitfalls in React — calling
setState on an unmounted component, multiple in-flight requests for the
same resource, and stale responses arriving out of order.

**What to create**

- A useAbortableEffect hook for AbortController-aware async work

- A requestDedup module for in-flight request deduplication

- A useLatestRequest hook to discard stale responses

**Where it goes**

- Abortable effect: src/hooks/useAbortableEffect.ts

- Request dedup: src/lib/requestDedup.ts

- Latest request hook: src/hooks/useLatestRequest.ts

**useAbortableEffect**

> // src/hooks/useAbortableEffect.ts
>
> import { useEffect } from 'react';
>
> export function useAbortableEffect(
>
> fn: (signal: AbortSignal) =\> Promise\<void\>,
>
> deps: unknown\[\]
>
> ) {
>
> useEffect(() =\> {
>
> const controller = new AbortController();
>
> fn(controller.signal).catch(err =\> {
>
> if (err?.name === 'AbortError') return;
>
> throw err;
>
> });
>
> return () =\> controller.abort();
>
> }, deps);
>
> }

**Request deduplication**

When a user rapidly toggles a filter, you may fire the same API call
multiple times. The dedup module returns the same in-flight promise for
any duplicate key.

> // src/lib/requestDedup.ts
>
> const pending = new Map\<string, Promise\<unknown\>\>();
>
> export async function dedupedRequest\<T\>(
>
> key: string,
>
> fn: () =\> Promise\<T\>
>
> ): Promise\<T\> {
>
> if (pending.has(key)) {
>
> return pending.get(key) as Promise\<T\>;
>
> }
>
> const promise = fn().finally(() =\> pending.delete(key));
>
> pending.set(key, promise);
>
> return promise;
>
> }

**Latest request hook**

When an older request resolves after a newer one (a real risk with
variable network conditions), the older response will overwrite the
newer one if you naively setState in the resolution callback. The fix is
a monotonic request ID.

> // src/hooks/useLatestRequest.ts
>
> import { useRef, useState, useCallback } from 'react';
>
> export function useLatestRequest\<T\>(fetchFn: () =\> Promise\<T\>) {
>
> const requestId = useRef(0);
>
> const \[data, setData\] = useState\<T \| null\>(null);
>
> const fetch = useCallback(async () =\> {
>
> const id = ++requestId.current;
>
> const result = await fetchFn();
>
> if (id === requestId.current) {
>
> setData(result);
>
> }
>
> }, \[fetchFn\]);
>
> return { data, fetch };
>
> }

**How to wire it in**

Replace useEffect with useAbortableEffect anywhere you launch an async
request based on props or state. Use dedupedRequest when wrapping
requests that may be triggered from multiple places at once. Use
useLatestRequest when the same component fires the same request multiple
times in sequence.

**3.5 Layer 5 — The global safety net**

Goal: catch anything that slipped through Layers 1–4 — uncaught
exceptions in event handlers, unhandled promise rejections from
third-party libraries, errors in setTimeout callbacks. Log them and
notify the user without breaking the page.

**What to create**

- A reporter module with reportError and initGlobalErrorHandlers

- A toast queue with deduplication

- A ToastStack component to render the queue

**Where it goes**

- Reporter: src/lib/reporter.ts

- Toast queue: src/lib/toastQueue.ts

- Toast UI: src/components/errors/ToastStack.tsx

**The reporter**

> // src/lib/reporter.ts
>
> import { showToast } from './toastQueue';
>
> export function reportError(
>
> error: Error,
>
> context: Record\<string, unknown\> = {}
>
> ) {
>
> if (import.meta.env?.DEV) {
>
> console.error('\[Error\]', error, context);
>
> return;
>
> }
>
> // Production: forward to Sentry/Datadog/etc.
>
> // Sentry.captureException(error, { extra: context });
>
> }
>
> export function initGlobalErrorHandlers() {
>
> window.onerror = (message, source, line, col, error) =\> {
>
> reportError(
>
> error ?? new Error(String(message)),
>
> { context: 'window.onerror', source, line, col }
>
> );
>
> showToast({
>
> type: 'error',
>
> message: 'Something unexpected happened.',
>
> action: { label: 'Reload', fn: () =\> location.reload() },
>
> });
>
> return true; // suppress browser default dialog
>
> };
>
> window.addEventListener('unhandledrejection', (event) =\> {
>
> event.preventDefault();
>
> const err = event.reason instanceof Error
>
> ? event.reason
>
> : new Error(String(event.reason));
>
> reportError(err, { context: 'unhandledrejection' });
>
> // Don't toast for intentional aborts
>
> if (err.name === 'AbortError') return;
>
> showToast({
>
> type: 'error',
>
> message: 'A background operation failed.',
>
> duration: 5000,
>
> });
>
> });
>
> }

**The toast queue**

> // src/lib/toastQueue.ts
>
> export interface Toast {
>
> id: string;
>
> type: 'error' \| 'warning' \| 'info' \| 'success';
>
> message: string;
>
> action?: { label: string; fn: () =\> void };
>
> duration?: number;
>
> }
>
> const listeners = new Set\<(toasts: Toast\[\]) =\> void\>();
>
> let queue: Toast\[\] = \[\];
>
> export function subscribe(fn: (toasts: Toast\[\]) =\> void) {
>
> listeners.add(fn);
>
> fn(queue);
>
> return () =\> { listeners.delete(fn); };
>
> }
>
> export function showToast(toast: Omit\<Toast, 'id'\>) {
>
> // Deduplicate: same message within 5 seconds = ignored
>
> if (queue.some(t =\> t.message === toast.message)) return;
>
> const id = crypto.randomUUID();
>
> queue = \[...queue, { ...toast, id }\];
>
> listeners.forEach(fn =\> fn(queue));
>
> setTimeout(() =\> dismissToast(id), toast.duration ?? 4000);
>
> }
>
> export function dismissToast(id: string) {
>
> queue = queue.filter(t =\> t.id !== id);
>
> listeners.forEach(fn =\> fn(queue));
>
> }

**How to wire it in**

The most important rule: initGlobalErrorHandlers MUST be the first line
in main.tsx, before React even mounts. If it runs later, errors thrown
during initial render will be missed.

> // src/main.tsx — first line, before everything else
>
> import { initGlobalErrorHandlers } from './lib/reporter';
>
> initGlobalErrorHandlers();
>
> // then React imports, then createRoot, etc.

**3.6 Layer 6 — Client-side validation**

Goal: catch every invalid input before it reaches the API. The user gets
inline, field-level red messages that explain exactly what is wrong; the
submit button is blocked until everything passes.

**The golden rule**

> **Field tells field-level errors:** Validation belongs where the
> user's eyes already are — on the failed field. Toasts are for async
> results; never use a toast as the only signal that validation failed.
> Field-level red messages first, summary banner if there are 3 or more,
> never a bare toast.

**What to create**

- Schema files in src/schemas/

- A reusable FieldError component

- A ValidationSummary component for many-error cases

- A typed form hook combining react-hook-form and Zod

**Where it goes**

- Column primitives: src/schemas/columns/\*.schema.ts

- Form schemas: src/schemas/\[name\]Form.schema.ts

- FieldError: src/components/errors/FieldError.tsx

- ValidationSummary: src/components/errors/ValidationSummary.tsx

**Layered schema architecture**

Schemas come in three layers: primitive column schemas (text, number,
date, etc.) that match Monday's column types; composed form schemas that
combine those primitives for a specific form; and refined schemas that
add cross-field rules and transform the data into Monday's API shape.

**Column primitives example**

> // src/schemas/columns/text.schema.ts
>
> import { z } from 'zod';
>
> export const MondayTextSchema = z
>
> .string()
>
> .max(255, 'Must be 255 characters or fewer')
>
> .trim();
>
> export const MondayEmailSchema = z
>
> .string()
>
> .email('Enter a valid email address')
>
> .toLowerCase()
>
> .trim();
>
> // src/schemas/columns/structured.schema.ts
>
> export const MondayDateSchema = z
>
> .string()
>
> .regex(/^\d{4}-\d{2}-\d{2}\$/, 'Use format YYYY-MM-DD')
>
> .refine(val =\> !isNaN(Date.parse(val)), 'Enter a valid date')
>
> .nullable();
>
> export const MondayNumberSchema = z
>
> .number({ invalid_type_error: 'Enter a number' })
>
> .finite('Enter a finite number');
>
> // Board-dependent: valid labels come from Monday API at runtime
>
> export const mondayStatusSchema = (validLabels: string\[\]) =\>
>
> z.string().refine(
>
> val =\> validLabels.includes(val),
>
> 'Select a valid status'
>
> );

**Composed form schema**

> // src/schemas/createItemForm.schema.ts
>
> import { z } from 'zod';
>
> import { MondayTextSchema } from './columns/text.schema';
>
> import {
>
> MondayDateSchema, MondayNumberSchema, mondayStatusSchema,
>
> } from './columns/structured.schema';
>
> interface BoardConfig {
>
> statusLabels: string\[\];
>
> }
>
> export function createItemFormSchema(board: BoardConfig) {
>
> return z.object({
>
> name: MondayTextSchema.min(1, 'Item name is required'),
>
> startDate: MondayDateSchema,
>
> dueDate: MondayDateSchema,
>
> status: mondayStatusSchema(board.statusLabels),
>
> estimatedHours: MondayNumberSchema
>
> .positive('Must be greater than 0')
>
> .optional(),
>
> })
>
> .superRefine((data, ctx) =\> {
>
> if (data.startDate && data.dueDate) {
>
> if (new Date(data.dueDate) \< new Date(data.startDate)) {
>
> ctx.addIssue({
>
> code: z.ZodIssueCode.custom,
>
> path: \['dueDate'\],
>
> message: 'Due date must be on or after the start date',
>
> });
>
> }
>
> }
>
> });
>
> }
>
> export type CreateItemFormValues = z.infer\<
>
> ReturnType\<typeof createItemFormSchema\>
>
> \>;

**FieldError component**

> // src/components/errors/FieldError.tsx
>
> interface Props {
>
> id: string;
>
> message?: string;
>
> }
>
> export function FieldError({ id, message }: Props) {
>
> if (!message) return null;
>
> return (
>
> \<p
>
> id={id}
>
> role="alert"
>
> aria-live="polite"
>
> style={{
>
> color: 'var(--color-text-danger)',
>
> fontSize: 13,
>
> marginTop: 4,
>
> }}
>
> \>
>
> {message}
>
> \</p\>
>
> );
>
> }

**Form hook wiring**

> // src/hooks/useCreateItemForm.ts
>
> import { useMemo } from 'react';
>
> import { useForm } from 'react-hook-form';
>
> import { zodResolver } from '@hookform/resolvers/zod';
>
> import {
>
> createItemFormSchema,
>
> CreateItemFormValues,
>
> } from '../schemas/createItemForm.schema';
>
> export function useCreateItemForm(board: { statusLabels: string\[\] })
> {
>
> const schema = useMemo(() =\> createItemFormSchema(board), \[board\]);
>
> return useForm\<CreateItemFormValues\>({
>
> resolver: zodResolver(schema),
>
> mode: 'onBlur',
>
> reValidateMode: 'onChange',
>
> });
>
> }

**API errors back into the form**

When Monday rejects a save with field-specific errors, inject them back
into the form instead of showing a toast. This keeps the user's eyes on
the failing field.

> try {
>
> await mondayApiCall(MUTATION, payload);
>
> } catch (err) {
>
> if (err instanceof MondayApiError && err.fieldErrors) {
>
> err.fieldErrors.forEach(({ field, message }) =\> {
>
> form.setError(field as keyof CreateItemFormValues, { message });
>
> });
>
> } else {
>
> showToast({ type: 'error', message: 'Could not save. Please try
> again.' });
>
> }
>
> }

**3.7 Layer 7 — Monday SDK errors**

Goal: handle SDK-specific failure modes that have no analogue in regular
web development. The SDK can fail to initialize without throwing, the
app may be loaded outside of Monday, permissions may not be granted, and
individual SDK methods like execute and listen can fail in opaque ways.
Each of these requires a dedicated handler and dedicated user-facing UI.

**The four SDK failure modes**

- SDK initialization timeout — monday.init succeeded but the context
  event never fired

- Wrong context — the app loaded but accountId or userId is missing,
  meaning it is rendered outside Monday

- Missing permission — the app is installed but the required OAuth scope
  was not granted

- SDK method failure — monday.execute or monday.listen threw or returned
  malformed data

**What to create**

- SDK-specific error classes in src/errors/MondaySdkError.ts

- An initialization function in src/lib/mondaySdk.ts

- A MondaySdkProvider that gates the app on init success

- Wrapped sdkExecute and sdkListen helpers in src/lib/sdkMethods.ts

- Four full-screen fallback components, one per failure mode

**SDK error classes**

> // src/errors/MondaySdkError.ts
>
> export class SdkNotInitializedError extends Error {
>
> name = 'SdkNotInitializedError';
>
> constructor() {
>
> super('monday.init() did not complete within the expected time');
>
> }
>
> }
>
> export class WrongContextError extends Error {
>
> name = 'WrongContextError';
>
> constructor(public receivedContext: string) {
>
> super(\`App rendered outside Monday.com\`);
>
> }
>
> }
>
> export class MissingPermissionError extends Error {
>
> name = 'MissingPermissionError';
>
> constructor(public scope: string) {
>
> super(\`Required permission not granted: \${scope}\`);
>
> }
>
> }
>
> export class SdkMethodError extends Error {
>
> name = 'SdkMethodError';
>
> constructor(public method: string, public cause: unknown) {
>
> super(\`monday.\${method}() failed\`);
>
> }
>
> }

**SDK initialization with timeout**

> // src/lib/mondaySdk.ts
>
> import monday from 'monday-sdk-js';
>
> import {
>
> SdkNotInitializedError,
>
> WrongContextError,
>
> MissingPermissionError,
>
> } from '../errors/MondaySdkError';
>
> const INIT_TIMEOUT_MS = 8000;
>
> export interface MondayContext {
>
> boardId: number;
>
> itemId?: number;
>
> userId: number;
>
> accountId: number;
>
> theme: 'light' \| 'dark';
>
> instanceType: string;
>
> }
>
> export async function initMondaySdk(): Promise\<MondayContext\> {
>
> monday.init();
>
> const contextPromise = new Promise\<MondayContext\>((resolve, reject)
> =\> {
>
> monday.listen('context', (res) =\> {
>
> if (!res?.data) {
>
> reject(new SdkNotInitializedError());
>
> return;
>
> }
>
> resolve(res.data as MondayContext);
>
> });
>
> });
>
> const timeout = new Promise\<never\>((\_, reject) =\>
>
> setTimeout(() =\> reject(new SdkNotInitializedError()),
> INIT_TIMEOUT_MS)
>
> );
>
> const ctx = await Promise.race(\[contextPromise, timeout\]);
>
> if (!ctx.accountId \|\| !ctx.userId) {
>
> throw new WrongContextError(JSON.stringify(ctx));
>
> }
>
> return ctx;
>
> }
>
> export async function checkPermissions(): Promise\<void\> {
>
> const res = await monday.api('{ me { id } }');
>
> if (res?.errors) {
>
> const scopeError = res.errors.find(
>
> (e: any) =\> e.extensions?.code === 'INSUFFICIENT_SCOPE'
>
> );
>
> if (scopeError) {
>
> const missing = scopeError.extensions?.requiredScope ?? 'unknown';
>
> throw new MissingPermissionError(missing);
>
> }
>
> }
>
> }

**MondaySdkProvider**

> // src/providers/MondaySdkProvider.tsx
>
> import { createContext, useContext, useEffect, useState, ReactNode }
> from 'react';
>
> import { initMondaySdk, MondayContext } from '../lib/mondaySdk';
>
> import {
>
> WrongContextError,
>
> MissingPermissionError,
>
> } from '../errors/MondaySdkError';
>
> import { reportError } from '../lib/reporter';
>
> import { SdkLoadingScreen } from
> '../components/errors/SdkLoadingScreen';
>
> import { WrongContextScreen } from
> '../components/errors/WrongContextScreen';
>
> import { SdkFailedScreen } from
> '../components/errors/SdkFailedScreen';
>
> import { MissingPermissionScreen } from
> '../components/errors/MissingPermissionScreen';
>
> type SdkState =
>
> \| { status: 'loading' }
>
> \| { status: 'ready'; context: MondayContext }
>
> \| { status: 'wrong-context' }
>
> \| { status: 'missing-permission'; scope: string }
>
> \| { status: 'init-failed'; error: Error };
>
> const Ctx = createContext\<MondayContext \| null\>(null);
>
> export function useMondayContext() {
>
> const ctx = useContext(Ctx);
>
> if (!ctx) throw new Error('useMondayContext must be used inside
> provider');
>
> return ctx;
>
> }
>
> export function MondaySdkProvider({ children }: { children: ReactNode
> }) {
>
> const \[state, setState\] = useState\<SdkState\>({ status: 'loading'
> });
>
> useEffect(() =\> {
>
> initMondaySdk()
>
> .then(context =\> setState({ status: 'ready', context }))
>
> .catch(err =\> {
>
> reportError(err, { context: 'sdk-init' });
>
> if (err instanceof WrongContextError) {
>
> setState({ status: 'wrong-context' });
>
> } else if (err instanceof MissingPermissionError) {
>
> setState({ status: 'missing-permission', scope: err.scope });
>
> } else {
>
> setState({ status: 'init-failed', error: err });
>
> }
>
> });
>
> }, \[\]);
>
> if (state.status === 'loading') return \<SdkLoadingScreen /\>;
>
> if (state.status === 'wrong-context') return \<WrongContextScreen /\>;
>
> if (state.status === 'missing-permission')
>
> return \<MissingPermissionScreen scope={state.scope} /\>;
>
> if (state.status === 'init-failed')
>
> return \<SdkFailedScreen error={state.error} /\>;
>
> return \<Ctx.Provider
> value={state.context}\>{children}\</Ctx.Provider\>;
>
> }

**Wrapping individual SDK methods**

> // src/lib/sdkMethods.ts
>
> import monday from 'monday-sdk-js';
>
> import { SdkMethodError } from '../errors/MondaySdkError';
>
> import { reportError } from './reporter';
>
> export async function sdkExecute\<T\>(
>
> type: string,
>
> params?: Record\<string, unknown\>
>
> ): Promise\<T\> {
>
> try {
>
> const res = await monday.execute(type, params);
>
> if (!res?.data) throw new Error('Empty execute response');
>
> return res.data as T;
>
> } catch (err) {
>
> throw new SdkMethodError(\`execute(\${type})\`, err);
>
> }
>
> }
>
> export function sdkListen\<T\>(
>
> event: string,
>
> callback: (data: T) =\> void,
>
> onError?: (err: SdkMethodError) =\> void
>
> ): () =\> void {
>
> let unsub: (() =\> void) \| undefined;
>
> try {
>
> unsub = monday.listen(event, (res: any) =\> {
>
> if (res?.data !== undefined) {
>
> callback(res.data as T);
>
> }
>
> });
>
> } catch (err) {
>
> const sdkErr = new SdkMethodError(\`listen(\${event})\`, err);
>
> reportError(sdkErr, { event });
>
> onError?.(sdkErr);
>
> }
>
> return () =\> { unsub?.(); };
>
> }

**How to wire it in**

Place MondaySdkProvider at the top of the React tree, just inside the
root ErrorBoundary. Replace any direct monday.execute or monday.listen
calls in your app with sdkExecute and sdkListen so all SDK calls funnel
through the error pipeline.

**4. The boot order**

All seven layers must be activated in a specific order. Get this wrong
and you may see, for example, the global error handler fail to catch
errors thrown during the initial React render — because it had not been
installed yet.

**The correct order**

1.  Install global error handlers (Layer 5) — first line of main.tsx,
    before any other import side effects

2.  Mount the root ErrorBoundary (Layer 1) — wraps the entire React tree

3.  Mount the MondaySdkProvider (Layer 7) — gates the app on SDK
    readiness

4.  Mount the NetworkStatusBanner (Layer 3) — offline detection

5.  Mount the ToastStack (Layer 5) — renders the toast queue

6.  Mount your application

**The full main.tsx**

> // src/main.tsx
>
> import { initGlobalErrorHandlers } from './lib/reporter';
>
> // 1. Global handlers MUST go first, before any imports that could
> throw at load time.
>
> initGlobalErrorHandlers();
>
> // 2. Now React, providers, and components.
>
> import React from 'react';
>
> import { createRoot } from 'react-dom/client';
>
> import { ErrorBoundary } from './components/errors/ErrorBoundary';
>
> import { MondaySdkProvider } from './providers/MondaySdkProvider';
>
> import { NetworkStatusBanner } from
> './components/errors/NetworkStatusBanner';
>
> import { ToastStack } from './components/errors/ToastStack';
>
> import { AppCrashFallback } from
> './components/errors/AppCrashFallback';
>
> import { App } from './App';
>
> createRoot(document.getElementById('root')!).render(
>
> \<React.StrictMode\>
>
> \<ErrorBoundary fallback={AppCrashFallback}\>
>
> \<MondaySdkProvider\>
>
> \<NetworkStatusBanner\>
>
> \<ToastStack\>
>
> \<App /\>
>
> \</ToastStack\>
>
> \</NetworkStatusBanner\>
>
> \</MondaySdkProvider\>
>
> \</ErrorBoundary\>
>
> \</React.StrictMode\>
>
> );
>
> **Critical:** Do NOT import any application module before
> initGlobalErrorHandlers runs. If a module-level statement somewhere
> down the tree throws during the import phase, you want the global
> handler in place to catch it. The literal first line of main.tsx must
> be the import of the reporter, immediately followed by
> initGlobalErrorHandlers().

**Why this order**

- Global handlers first: any error thrown during React mounting,
  third-party library init, or even before the first React render needs
  to land in the reporter.

- ErrorBoundary outermost: it must wrap the SDK provider so that if the
  provider itself crashes (e.g. a type error in initMondaySdk), the user
  sees the AppCrashFallback instead of a blank page.

- SDK provider next: the rest of the app depends on the Monday context,
  so we gate everything below it on the SDK being ready.

- NetworkStatusBanner above ToastStack: the banner is structural (always
  visible at the top); toasts float on top of the layout.

- ToastStack near the leaves: components anywhere can call showToast and
  the rendered toasts appear inside the ToastStack provider.

**5. The folder structure**

Every file from the seven layers fits into the following structure. The
architecture follows one strict rule: nothing in components/ imports
from lib/ directly. Components only import from hooks/, and hooks import
from lib/. This makes all error logic testable without mounting a single
React component.

**The full tree**

> src/
>
> ├── errors/ \# Typed error classes
>
> │ ├── MondayApiError.ts \# Layer 2: API error hierarchy
>
> │ ├── MondaySdkError.ts \# Layer 7: SDK-specific errors
>
> │ └── index.ts \# barrel export
>
> │
>
> ├── schemas/ \# Zod schemas (Layer 6)
>
> │ ├── columns/
>
> │ │ ├── text.schema.ts \# text, email, phone, link
>
> │ │ ├── structured.schema.ts \# date, number, status, dropdown
>
> │ │ ├── relation.schema.ts \# people, board_relation, files
>
> │ │ └── index.ts
>
> │ ├── createItemForm.schema.ts
>
> │ ├── editItemForm.schema.ts
>
> │ └── index.ts
>
> │
>
> ├── lib/ \# Pure functions, no React
>
> │ ├── mondayClient.ts \# Layer 2: mondayApiCall + retry
>
> │ ├── mondaySdk.ts \# Layer 7: initMondaySdk + checkPermissions
>
> │ ├── sdkMethods.ts \# Layer 7: sdkExecute + sdkListen
>
> │ ├── withTimeout.ts \# Layer 3: promise timeout
>
> │ ├── reporter.ts \# Layer 5: reportError + initGlobalErrorHandlers
>
> │ ├── requestDedup.ts \# Layer 4: in-flight dedup
>
> │ ├── toastQueue.ts \# Shared: toast queue with dedup
>
> │ └── errorMessages.ts \# Shared: user-facing message map
>
> │
>
> ├── hooks/ \# React hooks
>
> │ ├── useApi.ts \# Layer 2+3: loading/error/data
>
> │ ├── useAbortableEffect.ts \# Layer 4: AbortController cleanup
>
> │ ├── useNetworkStatus.ts \# Layer 3: online/offline
>
> │ ├── useLatestRequest.ts \# Layer 4: stale-response guard
>
> │ └── useCreateItemForm.ts \# Layer 6: form hook
>
> │
>
> ├── providers/
>
> │ └── MondaySdkProvider.tsx \# Layer 7: gates app on SDK init
>
> │
>
> ├── components/
>
> │ └── errors/ \# Pure UI components
>
> │ ├── ErrorBoundary.tsx \# Layer 1
>
> │ ├── FieldError.tsx \# Layer 6: inline field message
>
> │ ├── ValidationSummary.tsx \# Layer 6: multi-field banner
>
> │ ├── ToastStack.tsx \# Shared: renders the queue
>
> │ ├── NetworkStatusBanner.tsx \# Layer 3: offline banner
>
> │ ├── SlowLoadingWrapper.tsx \# Layer 3: progressive loading
>
> │ ├── SdkLoadingScreen.tsx \# Layer 7
>
> │ ├── WrongContextScreen.tsx \# Layer 7
>
> │ ├── SdkFailedScreen.tsx \# Layer 7
>
> │ ├── MissingPermissionScreen.tsx \# Layer 7
>
> │ ├── AppCrashFallback.tsx \# Layer 1: full-app crash
>
> │ └── WidgetErrorFallback.tsx \# Layer 1: per-widget crash
>
> │
>
> └── main.tsx \# Entry point with boot order

**Import discipline**

Follow these import rules strictly. They are what keep the system
testable and refactorable over time.

- components/ may import from hooks/ and components/. Never from lib/.

- hooks/ may import from lib/, errors/, and schemas/. Never from
  components/.

- lib/ may import from errors/ and other lib/. Never from hooks/ or
  components/.

- schemas/ may only import from other schemas/. Never from anywhere
  else.

- errors/ is leaf-level. It imports from nothing in this list.

**6. UX rules cheat sheet**

This table is the contract between the error handling system and the
user. For every error type, the user sees a specific kind of feedback,
with a specific message style and a specific recovery action. Print this
and hang it above your desk.

**What the user sees, per error type**

| **Error type** | **User sees** | **Recovery action** |
|:---|:---|:---|
| React render crash | Styled fallback in place of the crashed subtree | Try again button (resets the boundary) |
| API 4xx (general) | Inline error near the action that triggered it | Retry button or fix-input prompt |
| API 401 (auth) | Full-screen reconnect message | Automatic re-auth via monday.oauth |
| API 429 (rate limit) | Toast: Retrying automatically | Automatic retry with backoff |
| API 5xx | Inline error, retry button | Retry triggers exponential backoff |
| Network timeout | Toast: Request timed out | Retry button |
| Offline | Persistent top banner: You are offline | Banner clears automatically when back online |
| Slow loading (3s) | Still loading message | None — informational |
| Slow loading (10s) | Taking longer than usual + cancel | Cancel button aborts the request |
| Validation (1 field) | Inline red message under the field | Fix the field, error clears on change |
| Validation (3+ fields) | Inline messages + summary banner above submit | Fix fields, banner updates |
| Unhandled promise | Toast: A background operation failed | Reload page (if persistent) |
| Unhandled exception | Toast: Something unexpected happened | Reload button in the toast |
| SDK init timeout | Full-screen: Could not connect to Monday.com | Try again button reloads |
| Wrong context | Full-screen: Open this app inside Monday.com | No action (informational only) |
| Missing permission | Full-screen: Additional permission required | Link to admin documentation |
| SDK method failure | Toast: Action could not complete | Retry the action |

**Style rules for error messages**

- Sentence case, never Title Case. Title Case feels formal and
  corporate; sentence case feels human.

- No exclamation marks. Errors are not exciting.

- No technical jargon. Replace null pointer dereference with Something
  went wrong.

- Tell the user what to do. Add a verb: Try again, Reload, Reconnect,
  Fix the field.

- If the system is recovering automatically, say so. Retrying
  automatically is better than just Rate limited.

- Keep messages under 80 characters when possible. Longer messages do
  not get read.

- Never blame the user. Use that does not look right rather than you
  entered an invalid value.

**Where each surface lives**

Three distinct surfaces carry error information. Use the right one for
the right error.

- Inline (near the field or action) — for validation errors and
  action-specific failures.

- Toast (floating, transient) — for async background operations: API
  retries, save failures, unhandled rejections.

- Full-screen fallback — for unrecoverable states: app crash, SDK init
  failure, wrong context. Use sparingly.

**7. Monday SDK-specific gotchas**

The Monday SDK has several behaviors that surprise developers coming
from regular web apps. These are not documented prominently, so this
section calls each one out explicitly.

**Gotcha 1: monday.init silently succeeds even when the SDK cannot
communicate**

Calling monday.init does not return a promise and does not throw if the
host frame is unreachable. The only way to know the SDK actually
connected is to wait for the context event via monday.listen. If you
assume init success means everything is wired up, your app will silently
render a broken UI when loaded outside Monday.

**Fix:** Always race the context event against a timeout, as shown in
Layer 7. Treat init as a fire-and-forget; the real signal is the context
event.

**Gotcha 2: monday.api errors are not thrown — they are returned**

Unlike fetch or axios, monday.api resolves successfully even when the
server returned errors. The errors live in the errors array on the
response object. If you write try-catch around a monday.api call
expecting it to throw on 4xx, you will silently process error responses
as if they were data.

**Fix:** Always check res?.errors?.length before reading res.data. The
mondayApiCall wrapper from Layer 2 handles this correctly.

**Gotcha 3: rate limit responses include a retry-after hint**

When you hit Monday's rate limit, the error extensions object includes a
retryAfterMs field telling you exactly how long to wait. Many developers
retry immediately with their own arbitrary backoff, which gets them
rate-limited again. Use the server's hint.

**Gotcha 4: monday.listen returns a (sometimes) unsubscribable
callback**

The unsubscribe function returned by monday.listen is not consistent
across SDK versions and event types. Some return undefined. Always
defensively check before calling unsub. The sdkListen wrapper in Layer 7
handles this.

**Gotcha 5: the context event can fire multiple times**

If the user switches boards or views while your app is mounted,
monday.listen('context', ...) will fire again with the new context. If
your code assumes the context only arrives once, the second event will
be ignored. For the SDK provider, this is fine (we only care about the
first event for init). For board-watching components, you must update
state on every event.

**Gotcha 6: monday.execute returns different shapes per action type**

monday.execute('openItemCard') returns a different response shape than
monday.execute('confirm'). The SDK types are loose, so TypeScript will
not warn you. Always validate the response shape before using its
fields.

**Gotcha 7: the user can revoke OAuth scopes mid-session**

A Monday admin can change the app's permissions while your app is
running. The first request after the change will fail with
INSUFFICIENT_SCOPE. Do not assume a successful initial permission check
means permissions hold forever — handle the error class on every call.

**Gotcha 8: localStorage is shared across all apps in the same Monday
account**

If you store anything in localStorage, prefix it with your app ID.
Otherwise you will see strange cross-app interference, especially in dev
when multiple apps are loaded in the same account.

**Gotcha 9: the iframe sandbox blocks some browser APIs**

Inside a Monday iframe, certain browser APIs are restricted:
window.open, navigator.clipboard.writeText, and synchronous
XMLHttpRequest may fail or be silently no-op. Always test in a real
Monday embed, not just locally with monday.init mocked out.

**Gotcha 10: dev mode usually loads the app outside Monday**

During local development, your app typically runs at
http://localhost:3000 with no embedding Monday frame. The SDK init will
time out (Gotcha 1). Your WrongContextError or SdkNotInitializedError
will fire on every dev reload. To avoid this, add a dev-only bypass that
supplies a mock context when import.meta.env.DEV is true and no real
context arrives within 2 seconds.

> // Dev-only mock context, for src/lib/mondaySdk.ts
>
> if (import.meta.env.DEV) {
>
> return Promise.race(\[
>
> contextPromise,
>
> new Promise\<MondayContext\>(resolve =\>
>
> setTimeout(() =\> resolve({
>
> boardId: 0, userId: 0, accountId: 0,
>
> theme: 'light', instanceType: 'dev',
>
> }), 2000)
>
> ),
>
> \]);
>
> }

**8. Testing checklist**

After implementing all seven layers, verify each one independently using
the manual tests below. Then run the integration scenarios to confirm
the system holds up end-to-end.

**Layer 1: React render errors**

- Add a throw new Error('test') to a component's render method. Confirm
  the fallback UI appears.

- Click the Try again button. Confirm the error clears and the original
  component renders again (after removing the throw).

- Wrap two sibling components in their own boundaries; throw in one;
  confirm the other still renders.

- Confirm the error appears in the reporter (console.error in dev,
  Sentry in prod).

**Layer 2: API errors**

- Mock monday.api to return errors with code UNAUTHORIZED. Confirm
  AuthError is thrown and oauth() is called.

- Mock a RATE_LIMITED error with retryAfterMs: 1000. Confirm the call
  retries after one second.

- Mock a 500 error. Confirm exponential backoff: ~500ms, ~1000ms,
  ~2000ms, then surrender.

- Mock a malformed response (no data, no errors). Confirm
  MalformedResponseError is thrown.

- Confirm useApi exposes loading, error, data, and retry correctly.

**Layer 3: Network and slow loading**

- Open DevTools, set network to Offline. Confirm the offline banner
  appears immediately.

- Toggle back to Online. Confirm the banner disappears.

- Mock a request that takes 4 seconds. Confirm the Still loading message
  appears at 3 seconds.

- Mock a request that takes 12 seconds. Confirm the Taking longer than
  usual + cancel UI appears at 10 seconds.

- Confirm withTimeout throws a MondayApiError with code TIMEOUT after
  the configured duration.

**Layer 4: Race conditions**

- Trigger an async effect, then immediately unmount the component.
  Confirm no setState-on-unmounted warning appears in dev mode.

- Fire the same dedupedRequest call three times in quick succession.
  Confirm the underlying function only runs once.

- Trigger two requests where the older one resolves last. Confirm only
  the newer response is committed to state.

**Layer 5: Global safety net**

- In any event handler, write throw new Error('handler test'). Confirm
  window.onerror catches it and shows a toast.

- In any function, write Promise.reject(new Error('rejection test')).
  Confirm unhandledrejection catches it and reports.

- Trigger an AbortError (cancel a request). Confirm no toast appears
  (intentional aborts are silent).

- Confirm the same toast message is not shown twice within 5 seconds
  (deduplication).

**Layer 6: Validation**

- Submit a form with one empty required field. Confirm the inline error
  appears under the field, not as a toast.

- Submit a form with three+ invalid fields. Confirm the summary banner
  appears above the submit button, in addition to inline errors.

- Type into a previously invalid field. Confirm the error clears on the
  first valid keystroke.

- Trigger a superRefine cross-field rule (e.g. due date before start
  date). Confirm the error attaches to the correct field (dueDate, not
  startDate).

- Simulate an API field error response. Confirm setError injects it into
  the form, not a toast.

**Layer 7: SDK errors**

- Run the app with monday.init() never receiving a context event.
  Confirm SdkNotInitializedError fires after 8 seconds and the
  SdkFailedScreen appears.

- Run the app outside Monday (e.g. open at localhost without the embed).
  Confirm WrongContextError fires and the WrongContextScreen appears.

- Mock an INSUFFICIENT_SCOPE error from monday.api. Confirm
  MissingPermissionError fires and the MissingPermissionScreen names the
  missing scope.

- Throw inside a monday.execute call. Confirm SdkMethodError wraps the
  original error and is reported.

**Boot order**

- Throw in a module-level statement of any imported file. Confirm
  window.onerror still catches it. (If it does not,
  initGlobalErrorHandlers is being called too late.)

- Confirm the order of rendered fallbacks: SDK loading screen first,
  then the app, with the offline banner on top and toasts floating
  above.

**Integration scenarios**

End-to-end scenarios that exercise multiple layers together. These are
the most realistic tests of system behavior.

7.  Submit a form with valid input while offline. Expected: offline
    banner appears, the API call is not attempted (or fails fast), a
    toast explains the action could not complete.

8.  Submit a form, then rapidly navigate away. Expected: no setState
    warnings, the request either completes or is aborted, no orphaned
    toasts.

9.  Have the user's auth token expire mid-session. Expected: the next
    API call fires AuthError, monday.oauth runs, the user reconnects
    without losing their place in the app.

10. Throw an error inside the success callback of a Monday API call.
    Expected: the global handler catches it, a toast appears, the rest
    of the app keeps working.

11. Open the app outside Monday (dev environment). Expected: in dev, the
    mock context resolves and the app renders; in prod, the
    WrongContextScreen appears.

**Definition of done**

> **Acceptance:** The error handling integration is complete when every
> checkbox in this section passes, every scenario in the integration
> list behaves as described, and a senior developer reviewing the final
> main.tsx confirms it matches the boot order in Section 4 exactly.
> Anything less leaves a gap somewhere in the seven layers.
