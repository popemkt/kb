import { parseSource, type GithubSource } from "@kb/extension-source";

/** A source as `parseSource` checks it: what both readers resolve and read. */
export const checkedSource = (source: GithubSource) =>
  parseSource(`github:${source.repo}${source.path === "" ? "" : `/${source.path}`}@${source.ref}`);
