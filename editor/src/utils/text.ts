export function autoResize(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0"
  textarea.style.height = textarea.scrollHeight + "px"
}

export function replacePendingUrls(body: string, urlMap: Map<string, string>): string {
  let result = body
  for (const [pendingUrl, realUrl] of urlMap) {
    result = result.split(pendingUrl).join(realUrl)
  }
  return result
}
