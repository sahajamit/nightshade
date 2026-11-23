/**
 * Must be the first import of the content script. The darkreader library wraps
 * chrome.runtime.sendMessage for its own fetch shim and drops the reply, so we keep
 * references to the browser's originals from before it loads.
 */
const runtime = chrome.runtime;
const nativeSend = runtime.sendMessage.bind(runtime) as (msg: unknown) => Promise<any>;
const nativeAddListener = runtime.onMessage.addListener.bind(runtime.onMessage);

export function sendToBackground<T = any>(msg: unknown): Promise<T> {
    return nativeSend(msg);
}

export const onBackgroundMessage = nativeAddListener;
