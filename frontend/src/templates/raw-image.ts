/**
 * Whether next/image must leave a picture alone: uploads served by the API
 * (/media), and the blob: / data: URLs the admin's live preview hands over
 * before anything is uploaded. Pictures shipped in /public keep the optimiser.
 */
export function rawImage(src: string): boolean {
  return src.startsWith("/media/") || src.startsWith("blob:") || src.startsWith("data:");
}
