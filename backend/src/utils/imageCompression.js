import sharp from "sharp";

export async function compressByPurpose(inputBuffer, purpose) {
  if (purpose === "qr-code") {
    return {
      buffer: await sharp(inputBuffer)
        .rotate()
        .resize({
          width: 300,
          height: 300,
          fit: "inside",
          withoutEnlargement: true
        })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true
        })
        .toBuffer(),
      contentType: "image/png",
      extension: "png"
    };
  }

  return {
    buffer: await sharp(inputBuffer)
      .rotate()
      .resize({
        width: 1200,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({
        quality: 80
      })
      .toBuffer(),
    contentType: "image/webp",
    extension: "webp"
  };
}
