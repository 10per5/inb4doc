import type { ContentProvider } from "@/providers/provider";
import { RemoteProvider } from "@/providers/remote-provider";
import { FileSystemProvider } from "@/providers/fs-provider";
import { LocalStorageProvider } from "@/providers/local-storage-provider";

export type ProviderType = "remote" | "filesystem" | "localStorage";

export function createProviderByType(type: ProviderType): ContentProvider {
  switch (type) {
    case "remote":
      return new RemoteProvider();
    case "filesystem":
      return new FileSystemProvider();
    case "localStorage":
      return new LocalStorageProvider();
  }
}
