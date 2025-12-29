import { clearViewContext, getViewContext, setViewContext } from "./viewContext";

export const ADD_COMMENT_CONTEXT_KEY = "redmine-client.canAddComments";

export const setCommentAddContext = async (value: boolean): Promise<void> => {
  await setViewContext(ADD_COMMENT_CONTEXT_KEY, value);
};

export const getCommentAddContext = (): boolean | undefined =>
  getViewContext<boolean>(ADD_COMMENT_CONTEXT_KEY);

export const clearCommentViewContext = (): void => {
  clearViewContext();
};
