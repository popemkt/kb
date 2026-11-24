/** Whether browser file metadata identifies an image. */
export function isImageFile(file: Pick<File, "type">): boolean {
  return file.type.startsWith("image/");
}
