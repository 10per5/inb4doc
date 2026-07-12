export class Image {
  readonly id: string
  dir: string
  file?: File
  blobUrl?: string
  url?: string
  storageUrl?: string
  usedIn: string[] = []

  constructor(id: string, dir: string, file?: File) {
    this.id = id
    this.dir = dir
    this.file = file
  }

  get name(): string {
    return this.id
  }

  get isPending(): boolean {
    return this.url === undefined
  }

  commit(url: string, storageUrl?: string): void {
    this.revokeBlobUrl()
    this.file = undefined
    this.url = url
    if (storageUrl) this.storageUrl = storageUrl
  }

  revokeBlobUrl(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl)
      this.blobUrl = undefined
    }
  }

  static fromRecord(record: { id: string; dir: string; file: File }): Image {
    const img = new Image(record.id, record.dir, record.file)
    img.blobUrl = URL.createObjectURL(record.file)
    return img
  }

  static fromEntry(entry: { name: string; url: string; storageUrl: string; usedIn: string[] }, dir: string): Image {
    const img = new Image(entry.name, dir)
    img.url = entry.url
    img.storageUrl = entry.storageUrl
    img.usedIn = [...entry.usedIn]
    return img
  }
}
