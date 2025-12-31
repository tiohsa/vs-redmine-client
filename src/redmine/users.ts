import { requestJson } from "./client";
import { RedmineCurrentUserResponse, RedmineUserRef } from "./types";

interface RedmineUserListResponse {
  users: Array<RedmineUserRef>;
}

export const getCurrentUserId = async (): Promise<number> => {
  const response = await requestJson<RedmineCurrentUserResponse>({
    method: "GET",
    path: "/users/current.json",
  });

  return response.user.id;
};

export const searchUsers = async (name: string): Promise<RedmineUserRef[]> => {
  const response = await requestJson<RedmineUserListResponse>({
    method: "GET",
    path: "/users.json",
    query: {
      name,
      limit: 10,
    },
  });

  return response.users ?? [];
};
