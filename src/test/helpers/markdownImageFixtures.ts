export const MARKDOWN_IMAGE_FIXTURES = {
  singleLocal: "Here is an image ![alt](./images/sample.png)",
  multipleLocal:
    "![one](./images/one.png) text ![two](../assets/two.jpg)",
  withTitle: "![alt](./images/sample.png \"Title\")",
  external: "![alt](https://example.com/image.png)",
  mixed: "![local](./img.png) and ![external](https://example.com/ext.png)",
};
