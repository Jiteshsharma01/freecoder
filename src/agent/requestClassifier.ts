export function isFileDeletionRequest(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  /*
   * Explicit filesystem deletion language.
   * Examples:
   * remove file logger.ts
   * delete file test.tsx
   * erase file config.json
   */
  if (
    /\b(?:remove|delete|erase)\s+(?:the\s+)?(?:file|folder|directory)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  /*
   * Filename-based deletion.
   * Examples:
   * remove testFile.tsx
   * delete logger.ts
   * This intentionally requires something that looks like a filename rather than accepting "remove unused".
   */
  if (
    /\b(?:remove|delete|erase)\s+[`"']?[A-Za-z0-9_$.-]+\.[A-Za-z0-9_-]+[`"']?/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}
