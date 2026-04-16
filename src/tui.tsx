/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createEffect, createSignal, onCleanup } from "solid-js";

import type { ProviderFetchCacheStore } from "./lib/quota-render-data.js";
import type { SidebarPanelState } from "./lib/tui-panel-state.js";

import { getSidebarPanelLines, shouldRenderSidebarPanel } from "./lib/tui-panel-state.js";
import { getSidebarBodyLineColor } from "./lib/tui-line-style.js";
import { loadSidebarPanel } from "./lib/tui-runtime.js";

const id = "@slkiser/opencode-quota";
// Place Quota near the top so variable-height built-in sections
// (MCP/LSP/Todo/Files) do not push it below the visible fold.
const SIDEBAR_ORDER = 150;
const REFRESH_INTERVAL_MS = 60_000;

function SidebarContentView(props: {
  api: TuiPluginApi;
  sessionID: string;
  providerFetchCache: ProviderFetchCacheStore;
}) {
  const [panel, setPanel] = createSignal<SidebarPanelState>({
    status: "loading",
    lines: [],
  });

  let disposed = false;
  let loadVersion = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const reload = () => {
    const currentVersion = ++loadVersion;

    void loadSidebarPanel({
      api: props.api,
      sessionID: props.sessionID,
      providerFetchCache: props.providerFetchCache,
    })
      .then((next) => {
        if (disposed || currentVersion !== loadVersion) return;
        setPanel(next);
      })
      .catch(() => {
        if (disposed || currentVersion !== loadVersion) return;
      });
  };

  const queueRefresh = (delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      reload();
    }, delay);
    timers.add(timer);
  };

  const scheduleRefresh = () => {
    queueRefresh(150);
    queueRefresh(600);
  };

  // TUI/session state can hydrate asynchronously after mount or session switch,
  // so retry a few times to recover from empty first-load reads.
  const scheduleMountRecovery = () => {
    queueRefresh(500);
    queueRefresh(1_500);
    queueRefresh(4_000);
  };

  createEffect(() => {
    props.sessionID;
    reload();
    scheduleMountRecovery();
  });

  const interval = setInterval(reload, REFRESH_INTERVAL_MS);
  const unsubscribers = [
    props.api.event.on("session.updated", (event) => {
      if (event.properties?.info?.id === props.sessionID) {
        scheduleRefresh();
      }
    }),
    props.api.event.on("message.updated", (event) => {
      if (event.properties?.info?.sessionID === props.sessionID) {
        scheduleRefresh();
      }
    }),
    props.api.event.on("message.removed", (event) => {
      if (event.properties?.sessionID === props.sessionID) {
        scheduleRefresh();
      }
    }),
    props.api.event.on("tui.session.select", (event) => {
      if (event.properties?.sessionID === props.sessionID) {
        scheduleRefresh();
      }
    }),
  ];

  onCleanup(() => {
    disposed = true;
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  if (!shouldRenderSidebarPanel(panel())) return null;

  const lines = () => getSidebarPanelLines(panel());

  return (
    <box gap={0}>
      <text fg={props.api.theme.current.text}>
        <b>Quota</b>
      </text>
      <box gap={0}>
        {lines().map((line) => (
          <text fg={getSidebarBodyLineColor(line, props.api.theme.current)} wrapMode="none">
            {line || " "}
          </text>
        ))}
      </box>
    </box>
  );
}

const tui: TuiPlugin = async (api) => {
  const providerFetchCache: ProviderFetchCacheStore = new Map();
  api.lifecycle.onDispose(() => {
    providerFetchCache.clear();
  });

  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, props: { session_id: string }) {
        return (
          <SidebarContentView
            api={api}
            sessionID={props.session_id}
            providerFetchCache={providerFetchCache}
          />
        );
      },
    },
  });
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default pluginModule;
