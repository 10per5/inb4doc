import type { ContentProvider } from "@/providers/provider";
import { RemoteProvider } from "@/providers/remote-provider";
import { MountProvider } from "@/providers/mount-provider";
import { FileSystemProvider } from "@/providers/fs-provider";
import { LocalStorageProvider } from "@/providers/local-storage-provider";

export enum ProviderType {
  Remote = 0,
  Filesystem = 1,
  LocalStorage = 2,
  Mount = 3,
}

export function createProviderByType(type: ProviderType): ContentProvider {
  switch (type) {
    case ProviderType.Remote:
      return new RemoteProvider();
    case ProviderType.Mount:
      return new MountProvider();
    case ProviderType.Filesystem:
      return new FileSystemProvider();
    case ProviderType.LocalStorage:
      return new LocalStorageProvider();
  }
}
