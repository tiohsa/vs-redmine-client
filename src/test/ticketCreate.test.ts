import * as assert from "assert";
import { buildIssueCreatePayload } from "../redmine/issues";

suite("Ticket creation payload", () => {
  test("builds payload from editor content", () => {
    const payload = buildIssueCreatePayload({
      projectId: 10,
      subject: "Sample",
      description: "Body",
      uploads: [
        {
          token: "token",
          filename: "image.png",
          content_type: "image/png",
        },
      ],
    });

    assert.deepStrictEqual(payload, {
      issue: {
        project_id: 10,
        subject: "Sample",
        description: "Body",
        uploads: [
          {
            token: "token",
            filename: "image.png",
            content_type: "image/png",
          },
        ],
      },
    });
  });
});
