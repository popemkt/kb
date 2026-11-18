import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineRule, eslintCompatPlugin, type ESTree } from "@oxlint/plugins";

const families = new Map<string, string | undefined>();

function familyOf(filename: string): string | undefined {
  const path = resolve(filename).replaceAll("\\", "/");
  const root = /^(.+\/packages\/extension\/[^/]+)\//.exec(path)?.[1];
  if (root === undefined) return undefined;
  if (families.has(root)) return families.get(root);
  const manifest: { nx?: { tags?: string[] } } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const family = manifest.nx?.tags?.find((tag) => tag.startsWith("family:"))?.slice(7);
  families.set(root, family);
  return family;
}

export const noForeignActionId = defineRule({
  meta: {
    type: "problem",
    messages: {
      foreign: "Inject the contribution key for {{id}} and call through that key.",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (/\/tests\/|\.(test|spec)\./.test(filename)) return {};
    const family = familyOf(filename);
    if (family === undefined) return {};
    const inspect = (node: ESTree.Node, value: string) => {
      const provider = /^ext\.([a-z0-9][a-z0-9-]*)\.[a-z0-9_][a-z0-9_.-]*$/i.exec(value)?.[1];
      if (provider !== undefined && provider !== family) {
        context.report({ node, messageId: "foreign", data: { id: value } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") inspect(node, node.value);
      },
      TemplateLiteral(node) {
        const prefix = node.quasis[0]?.value.cooked;
        if (typeof prefix !== "string") return;
        inspect(node, node.expressions.length === 0 ? prefix : `${prefix}partial`);
      },
    };
  },
});

export default eslintCompatPlugin({
  meta: { name: "extension-boundaries" },
  rules: { "no-foreign-action-id": noForeignActionId },
});
