import { requestJson } from "./client";
import { RedmineCurrentUserResponse } from "./types";

export const getCurrentUserId = async (): Promise<number> => {
  const response = await requestJson<RedmineCurrentUserResponse>({
    method: "GET",
    path: "/users/current.json",
  });

  return response.user.id;
};
