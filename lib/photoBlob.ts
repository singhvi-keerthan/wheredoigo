export function photoBlobPutOptions(token: string, contentType: string) {
  return {
    access: "private" as const,
    token,
    contentType,
    addRandomSuffix: false,
    // The pathname is deliberately deterministic. A successful Blob write can
    // be followed by a closed/frozen client before blobUrl reaches the synced
    // place record; that client must be able to retry the same photo id instead
    // of receiving BlobAlreadyExists forever.
    allowOverwrite: true,
  };
}
