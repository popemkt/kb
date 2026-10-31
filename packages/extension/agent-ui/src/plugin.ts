import { Effect } from "effect";
import { familyTags } from "@kb/contracts";
import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { agentExtension } from "@kb/agent";
import { definePlugin, type Plugin } from "@kb/plugin";
import { attachChat, type AgentPorts } from "./chat";
import { modelCompletion } from "./completion";
import { AgentDock } from "./surfaces";
import { BrowserHostService, DockPoint, ModelCompletionService } from "@kb/ui-sdk";

/**
 * The agent sidebar: a dock that chats with the agent the `kb ui` server
 * hosts (`@kb/agent`). The page loads it only while the server reports that
 * it hosts the agent (`ui-plugins.ts`), so its dock and its toggle exist
 * only then. The shell hands it its ports where it loads it, so this package
 * reaches neither the socket nor the invoke path itself.
 *
 * It provides the agent's completion to the page (`ModelCompletionService`),
 * so a half that wants a model's text injects it and waits while the agent
 * is off.
 */
export function agentUiPlugin(ports: AgentPorts): Plugin {
  return definePlugin({
    name: agentExtension.name,
    tags: familyTags(agentExtension, "ui"),
    inject: [BrowserHostService],
    apply: (ctx) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => attachChat(ports)),
          (detach) => Effect.sync(detach),
        );
        yield* ctx.provide(ModelCompletionService, modelCompletion(ports));
        yield* ctx.contribute(DockPoint, {
          id: "chat",
          value: { order: 0, label: "Agent", icon: ChatCircleDotsIcon, Component: AgentDock },
        });
      }),
  });
}
