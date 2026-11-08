import { createElement } from "react";
import type { ActionInvocation } from "@kb/contracts";
import { sandboxTrustDef } from "@kb/operations";
import type { ApprovalView } from "@kb/ui-sdk";
import { readExtensionCatalog, readExtensionDiff } from "@/lib/extension-report";
import { ExtensionEvidence } from "./extension-approval";
import { extensionLineDiff, type ExtensionLineDiff } from "@/lib/extension-line-diff";
export function readExtensionApproval(invocation: ActionInvocation): Promise<ApprovalView | null> {
  const input = sandboxTrustDef.inputSchema.parse(invocation.input);
  return readExtensionCatalog().then((listed) => {
    if ("problem" in listed) throw new Error(listed.problem);
    const row = listed.report.extensions.find(
      (candidate) => candidate.digest === input.digest && candidate.shadowed === undefined,
    );
    if (row === undefined) {
      if (input.extension !== undefined)
        throw new Error("This extension selection changed. List it and review it again.");
      return null;
    }
    if (
      input.extension !== undefined &&
      (row.name !== input.extension.name || row.files !== input.extension.files)
    )
      throw new Error("The extension's source no longer matches this review.");
    const view = (diff: ExtensionLineDiff | null): ApprovalView => ({
      content: createElement(ExtensionEvidence, { row, diff }),
      approveLabel: "Trust this digest",
    });
    if (row.origin.kind !== "install") return view(null);
    return readExtensionDiff(row).then(extensionLineDiff).then(view);
  });
}
