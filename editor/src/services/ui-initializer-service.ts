/**
 * UIInitializerService
 * 
 * Manages initialization and mounting of all UI components
 * Responsible for wiring up topbar, meta panel, and other UI elements
 */

import type { Editor } from "@milkdown/kit/core";
import type { TopbarAPI } from "../components/toolbar/topbar";
import type { MetaPanelAPI } from "../components/panels/meta-panel";
import { mountTopbar } from "../components/toolbar/topbar";
import { mountMetaPanel } from "../components/panels/meta-panel";
import { mountPrefsDialog } from "../components/dialogs/prefs-dialog";
import type { ViewType } from "../components/views/view";
import type { ViewManager } from "../components/views/view";

export interface UIInitializeOptions {
  onPrefs?: () => void;
  onDirtyClick?: () => void;
  onSingleDiscard?: (path: string) => void;
  onChangeProvider?: () => void;
  onViewChange?: (view: ViewType) => void;
  onSave?: () => void;
  onLoad?: () => void;
  onImageManager?: () => void;
  onToggleSidebar?: () => void;
  onToggleMetaPanel?: () => void;
  onMetaPanelChange?: (data: any) => void;
}

export class UIInitializerService {
  private topbar: TopbarAPI | null = null;
  private metaPanel: MetaPanelAPI | null = null;

  /**
   * Initialize toolbar and return API
   */
  public initializeTopbar(
    getEditor: () => Editor | null,
    options: UIInitializeOptions
  ): TopbarAPI | null {
    const toolbarEl = document.getElementById("app-toolbar");
    if (!toolbarEl) return null;

    this.topbar = mountTopbar(toolbarEl, getEditor, {
      onPrefs: () => {
        options.onPrefs?.();
        mountPrefsDialog({
          onStickyToolbarChange: (sticky) => {
            // This will be handled by caller
          },
        });
      },
      onDirtyClick: options.onDirtyClick ?? undefined,
      onSingleDiscard: options.onSingleDiscard ?? undefined,
      onChangeProvider: options.onChangeProvider ?? (() => {}),
      onViewChange: options.onViewChange ?? (() => {}),
      onSave: options.onSave,
      onLoad: options.onLoad,
      onImageManager: options.onImageManager,
      onToggleSidebar: options.onToggleSidebar,
      onToggleMetaPanel: options.onToggleMetaPanel,
    });

    return this.topbar;
  }

  /**
   * Initialize meta panel and return API
   */
  public initializeMetaPanel(
    onChange?: (data: any) => void
  ): MetaPanelAPI | null {
    const metaMount = document.getElementById("meta-panel-mount");
    if (!metaMount) return null;

    this.metaPanel = mountMetaPanel(metaMount, (data) => {
      onChange?.(data);
    });

    return this.metaPanel;
  }

  /**
   * Get topbar API
   */
  public getTopbar(): TopbarAPI | null {
    return this.topbar;
  }

  /**
   * Get meta panel API
   */
  public getMetaPanel(): MetaPanelAPI | null {
    return this.metaPanel;
  }

  /**
   * Update topbar provider badge
   */
  public setProviderBadge(icon: string, label: string): void {
    this.topbar?.setProviderBadge(icon, label);
  }

  /**
   * Update topbar provider type
   */
  public setProviderType(type: string): void {
    this.topbar?.setProviderType(type);
  }

  /**
   * Update dirty counter in topbar
   */
  public updateDirtyCounter(count: number, totalBytes: number, pendingCount: number = 0): void {
    this.topbar?.updateCounter(count, totalBytes, pendingCount);
    this.topbar?.setDirtyState(count > 0 || pendingCount > 0);
  }

  /**
   * Set current view in topbar
   */
  public setCurrentView(view: ViewType): void {
    this.topbar?.setView(view);
  }
}
