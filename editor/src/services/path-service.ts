import { editorSelfBase } from "../config";
import { getCurrentPath, buildEditorUrl } from "../utils/url";

export class PathService {
  getInitialPath(): string {
    return getCurrentPath();
  }

  getEditorSelfBase(): string {
    return editorSelfBase;
  }

  buildUrl(path: string): string {
    return buildEditorUrl(editorSelfBase, path);
  }
}
