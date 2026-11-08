import { IdentityPoint, ActionGuardPoint, type ExtensionReport } from "@kb/contracts";

export const ISO = "2026-10-20T00:00:00.000Z";
export const FILES = `sha256:${"cd".repeat(32)}`;
export const DIGEST = `sha256:${"ab".repeat(32)}`;

export const REPORT: ExtensionReport = {
  extensions: [
    {
      name: "outline",
      label: "Outline",
      required: "Synthetic: the page cannot draw without it.",
      enabled: true,
      source: "bundled",
      origin: { kind: "bundled" },
      tags: ["core"],
      declares: [],
      uses: [],
      injects: [],
      provides: [],
      failures: [],
    },
    {
      name: "graph",
      label: "Graph",
      enabled: true,
      source: "bundled",
      origin: { kind: "bundled" },
      tags: ["graph"],
      declares: [],
      uses: [],
      injects: [{ service: "kb.index", from: null }],
      provides: [],
      failures: [],
    },
    {
      name: "hello",
      label: "Hello",
      enabled: true,
      source: "/repo/.kb/extensions/hello.ts",
      origin: { kind: "own" },
      digest: DIGEST,
      tags: [],
      declares: [],
      uses: [],
      injects: [],
      provides: [],
      failures: ["hello/child failed to load: boom"],
    },
  ],
  roles: [],
  points: [
    {
      point: "identity.providers",
      owner: null,
      spec: IdentityPoint.spec,
      source: "host",
      listeners: [{ owner: "identity-header", id: "header" }],
    },
    {
      point: "action/guard",
      owner: null,
      spec: ActionGuardPoint.spec,
      source: "registry",
      listeners: [
        { owner: "governance", id: "ext.governance.approval", match: "*" },
        { owner: "governance", id: "ext.governance.force", match: "every write" },
      ],
    },
  ],
  failures: [{ file: "stranger.ts", error: `not trusted on this machine (${DIGEST})` }],
};
