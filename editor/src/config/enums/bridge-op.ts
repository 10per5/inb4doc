/**
 * Native bridge operations.
 *
 * Int-based (house enum pattern). callBridge() maps each value to the native
 * method name exposed on `window.saucer.exposed` (Android NativeBridge is
 * forwarded onto the same namespace). The int is a compile-time identifier for
 * type safety; it never crosses the bridge itself.
 */
export enum BridgeOp {
  GetTree,
  ReadFile,
  WriteFile,
  DeleteFiles,
  MoveFile,
  GetServerTime,
  Search,
  UploadImage,
  ListImages,
  RenameImage,
  DeleteImage,
  ResolveImage,
  PickDirectory,
  SetContentRoot,
  GetContentRoot,
}

const BRIDGE_OP_NAMES: Record<BridgeOp, string> = {
  [BridgeOp.GetTree]: "getTree",
  [BridgeOp.ReadFile]: "readFile",
  [BridgeOp.WriteFile]: "writeFile",
  [BridgeOp.DeleteFiles]: "deleteFiles",
  [BridgeOp.MoveFile]: "moveFile",
  [BridgeOp.GetServerTime]: "getServerTime",
  [BridgeOp.Search]: "search",
  [BridgeOp.UploadImage]: "uploadImage",
  [BridgeOp.ListImages]: "listImages",
  [BridgeOp.RenameImage]: "renameImage",
  [BridgeOp.DeleteImage]: "deleteImage",
  [BridgeOp.ResolveImage]: "resolveImage",
  [BridgeOp.PickDirectory]: "pickDirectory",
  [BridgeOp.SetContentRoot]: "setContentRoot",
  [BridgeOp.GetContentRoot]: "getContentRoot",
}

export function bridgeOpName(op: BridgeOp): string {
  return BRIDGE_OP_NAMES[op]
}
