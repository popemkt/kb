/**
 * The catalog smoke (`storiesRender`, `@kb/ui-test-kit`) over the outline's
 * own stories, which Storybook serves beside `@kb/ui`'s catalog.
 */
import { afterAll, beforeAll } from "vitest";
import { storiesRender } from "@kb/ui-test-kit";
import { syncUiPlugins } from "@kb/ui-sdk";
import * as fieldValueStories from "./field-value.stories";
import * as fieldValueStackStories from "./field-value-stack.stories";
import { outlineValueKindsPlugin } from "./slot-kind";

// The outline's kinds of the built-in field types, which its field editor draws.
beforeAll(() => syncUiPlugins([outlineValueKindsPlugin]));
afterAll(() => syncUiPlugins([]));

storiesRender([
  { name: "field-value", mod: fieldValueStories },
  { name: "field-value-stack", mod: fieldValueStackStories },
]);
