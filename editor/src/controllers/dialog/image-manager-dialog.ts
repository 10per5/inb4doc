import { openDialog } from "@/services/dialog-service"
import { loadImageManagerData } from "@/components/ui/image-manager"
import renderImageManagerRows from "@/eta/views/image-manager-rows"

export async function openImageManagerDialog(): Promise<void> {
  const data = await loadImageManagerData()

  openDialog("image-manager-dialog", {
    title: "Image Manager",
    dir: data.dir,
    loadError: data.loadError,
    allEntries: data.allEntries,
    rows: renderImageManagerRows(data as unknown as Record<string, unknown>),
  })
}
