import type { ExtensionContext } from "vscode";

let liveContext: ExtensionContext | undefined;

/** テスト専用の起動ラッパーが実ExtensionContextを渡す。 */
export const setLiveHostContext = (context: ExtensionContext): void => { liveContext = context; };
export const getLiveHostContext = (): ExtensionContext | undefined => liveContext;
