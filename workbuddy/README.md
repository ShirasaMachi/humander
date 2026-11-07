# Humander for WorkBuddy desktop

This is a standalone WorkBuddy plugin. It does not call or install DeepSeek Harness. Its MCP stdio process owns independent model sessions, the research protocol and persistent state. The WorkBuddy conversation opens the human panel and can request one bounded protocol phase; workers and secretary use separately configured OpenAI-compatible model routes.

## Install

The repository includes a CodeBuddy-compatible marketplace at its root. In current WorkBuddy desktop builds, open **Experts · Skills · Connectors**, select **Skills**, then **Bundles / 套件**. Hover over the `+` at the right end of the marketplace tabs to find **Add marketplace / 添加市场**. Enter `ShirasaMachi/humander` as the marketplace source; WorkBuddy's desktop Git clone does not interpret `#branch` fragments. Find the `humander` card in the `humander-research` marketplace and install it; check **Installed / 已安装** if the marketplace appears empty afterward. Restart WorkBuddy and open a new task to load the plugin. The manifest and plugin are at `.codebuddy-plugin/marketplace.json` and `workbuddy/.codebuddy-plugin/plugin.json`. The prebuilt `dist/` files are included; installation does not run npm.

For a local development installation, select the `workbuddy` directory as the plugin directory. The MCP server entrypoint is `dist/cli.mjs`. Node.js 24 or newer is required. The plugin declares a WorkBuddy-managed Node runtime, though exact plugin-manager and MCP Apps behavior still depends on the installed WorkBuddy desktop version.

Open a WorkBuddy task and ask it to open Humander. The model calls `humander_open`; WorkBuddy should show the MCP App in the conversation or artifact pane. Use **Fullscreen / 全屏** in the panel header to expand it within WorkBuddy when the host supports MCP App display modes. The panel lets the human configure providers, worker and secretary models, project rules, and a public publication repository. Then the human starts the requirement meeting. WorkBuddy may call `humander_advance` while this task is active. Closing WorkBuddy stops progress; the SQLite state and model sessions are restored on the next launch. No separate resident service or external scheduler is installed.

## Required local tools

- Windows research experiments require Docker Desktop using Linux containers and a **locally pulled** `python:3.12-slim` image. Linux uses Bubblewrap by default. Experiments fail closed if the sandbox is unavailable.
- Papers require `tectonic` with its offline dependency cache and `pdfinfo` on `PATH`. Chinese PDF output also needs Noto Serif CJK SC. These native tools are not bundled with the plugin.
- Every model route needs an OpenAI-compatible `/chat/completions` endpoint with function calling. Configure a base URL, model IDs and API key in the panel; keys are stored in the local Humander state directory.
- To submit a paper, configure a **public** GitHub repository and a fine-grained token with Contents write access. The plugin writes immutable, hash-addressed evidence to a separate `humander-public` branch and verifies the public bytes. Choose a repository intended for public research releases.

By default state is stored in `%APPDATA%\Humander` on Windows or `~/Humander` elsewhere. Set `HUMANDER_STATE_DIR` before starting WorkBuddy to use a different private directory. The process refuses a second simultaneous instance using the same state directory. `HUMANDER_PUBLIC_BASE_URL` remains an alternative for operators who serve the existing `releases/<hash>/` layout themselves.

Human decisions are made in the panel. The MCP App-only mutation tools are marked `visibility: ["app"]` and require a process-local capability. This depends on WorkBuddy honoring MCP Apps tool visibility; it must be checked on the target desktop version before treating the panel as an authorization boundary. The WorkBuddy conversation model is not a scientific chair or scheduler.

## Develop

```sh
cd workbuddy
npm ci --ignore-scripts
npm run build
npm test
```

The bundled plugin assets live in `dist/`, and the source files are in `workbuddy/` and `src/`. The DSH plugin in the same repository remains separately installable.
