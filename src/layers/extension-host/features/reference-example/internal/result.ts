import { scheduleTask } from "../../../../../packages/framework-core";

export function completeReferenceExample(): Promise<"ready"> {
  return new Promise(resolve => {
    scheduleTask(() => resolve("ready"), 0);
  });
}
