import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { noForeignActionId } from "./index.ts";

const filename = fileURLToPath(
  new URL("../../../packages/extension/ext-canvas/src/capability-example.ts", import.meta.url),
);
const tester = new RuleTester();

tester.run("extension-boundaries/no-foreign-action-id", noForeignActionId, {
  valid: [
    { filename, code: 'const action = "ext.canvas.run";' },
    { filename, code: 'const description = "Calls ext.agent.complete."; ' },
    { filename, code: "const action = CompleteAction.name;" },
  ],
  invalid: [
    {
      filename,
      code: 'const action = "ext.agent.complete";',
      errors: [{ messageId: "foreign" }],
    },
    {
      filename,
      code: "const action = `ext.code.script.${verb}`;",
      errors: [{ messageId: "foreign" }],
    },
  ],
});
